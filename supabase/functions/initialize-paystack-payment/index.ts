import {
  cors,
  customer,
  failure,
  json,
  RequestError,
  rows,
} from "../_shared/server.ts";
import { assertTrustedPricing } from "../_shared/catalog.ts";
import { verifyAndRecord } from "../_shared/payments.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  let reservedReference = "";
  try {
    const { user, env } = await customer(request);
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) {
      throw new RequestError("Online payment is temporarily unavailable.", 503);
    }
    const { orderNumber } = await request.json();
    if (
      typeof orderNumber !== "string" ||
      !/^TRK-[0-9]{13}-[A-Z0-9]{4}$/.test(orderNumber)
    ) throw new RequestError("Invalid order number.");
    const [order] = await rows("orders", {
      order_number: `eq.${orderNumber}`,
      user_id: `eq.${user.id}`,
      select: "*",
    });
    if (!order) throw new RequestError("Order not found in your account.", 404);
    if (
      order.payment_status !== "pending" || order.status === "Order Cancelled"
    ) {
      throw new RequestError(
        order.payment_status === "paid"
          ? "This order is already paid."
          : "This order cannot be paid.",
        409,
      );
    }
    await assertTrustedPricing(order);
    const [active] = await rows("payment_attempts", {
      order_id: `eq.${order.id}`,
      state: "in.(initializing,ready)",
      select: "*",
    });
    if (active?.authorization_url && active.state === "ready") {
      const checked = await verifyAndRecord(active.reference, {
        order,
        attempt: active,
      });
      if (checked.state === "success") {
        throw new RequestError(
          "This order is already paid. Open your account to view its receipt.",
          409,
        );
      }
      if (checked.state === "pending") {
        return json({ authorizationUrl: active.authorization_url });
      }
    }
    if (active && active.state === "initializing") {
      if (Date.now() - Date.parse(active.created_at) < 120000) {
        throw new RequestError(
          "A payment is being prepared. Wait a moment and try again.",
          409,
        );
      }
      const expired = await fetch(
        `${env.url}/rest/v1/payment_attempts?reference=eq.${
          encodeURIComponent(active.reference)
        }&state=eq.initializing`,
        {
          method: "PATCH",
          headers: env.headers,
          body: JSON.stringify({ state: "failed" }),
        },
      );
      if (!expired.ok) {
        throw new RequestError(
          "Could not retry payment. Please try again.",
          503,
        );
      }
    }
    const amount = Math.round(Number(order.estimated_total) * 100);
    if (
      !Number.isSafeInteger(amount) || amount < 1 || order.currency !== "GHS"
    ) throw new RequestError("Invalid order total.");
    // Preserve a reference issued by the old checkout so its webhook still resolves.
    if (order.payment_reference) {
      const old = await rows("payment_attempts", {
        reference: `eq.${order.payment_reference}`,
        select: "reference",
      });
      if (!old.length) {
        const legacy = await fetch(`${env.url}/rest/v1/payment_attempts`, {
          method: "POST",
          headers: env.headers,
          body: JSON.stringify({
            reference: order.payment_reference,
            order_id: order.id,
            amount,
            currency: "GHS",
            state: "failed",
          }),
        });
        if (!legacy.ok && legacy.status !== 409) {
          throw new RequestError(
            "Could not prepare payment. Please retry.",
            503,
          );
        }
      }
    }
    const reference = `TRK-${crypto.randomUUID()}`;
    const reserved = await fetch(`${env.url}/rest/v1/payment_attempts`, {
      method: "POST",
      headers: env.headers,
      body: JSON.stringify({
        reference,
        order_id: order.id,
        amount,
        currency: "GHS",
      }),
    });
    if (!reserved.ok) {
      throw new RequestError(
        "Another payment is being prepared. Please refresh your order and retry.",
        409,
      );
    }
    reservedReference = reference;
    const initialized = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          email: user.email,
          amount,
          currency: "GHS",
          reference,
          callback_url: "https://trikonicimports.com/?payment=return",
          metadata: {
            order_number: order.order_number,
            order_id: order.id,
            user_id: user.id,
          },
        }),
      },
    );
    const data = await initialized.json();
    let authorization: URL;
    try {
      authorization = new URL(data.data?.authorization_url);
    } catch {
      authorization = new URL("https://invalid.local");
    }
    if (
      !initialized.ok || data.status !== true ||
      authorization.protocol !== "https:" ||
      authorization.hostname !== "checkout.paystack.com" ||
      data.data?.reference !== reference
    ) {
      await fetch(
        `${env.url}/rest/v1/payment_attempts?reference=eq.${reference}`,
        {
          method: "PATCH",
          headers: env.headers,
          body: JSON.stringify({ state: "failed" }),
        },
      );
      throw new RequestError("Could not start payment. Please try again.", 502);
    }
    const saved = await fetch(
      `${env.url}/rest/v1/payment_attempts?reference=eq.${reference}`,
      {
        method: "PATCH",
        headers: env.headers,
        body: JSON.stringify({
          state: "ready",
          authorization_url: authorization.href,
        }),
      },
    );
    if (!saved.ok) {
      throw new RequestError(
        "Could not save the payment link. Please retry.",
        503,
      );
    }
    const current = await fetch(
      `${env.url}/rest/v1/orders?id=eq.${order.id}&payment_status=eq.pending`,
      {
        method: "PATCH",
        headers: env.headers,
        body: JSON.stringify({ payment_reference: reference }),
      },
    );
    if (!current.ok) {
      throw new RequestError(
        "Could not save the payment reference. Please retry.",
        503,
      );
    }
    return json({ authorizationUrl: authorization.href });
  } catch (error) {
    if (reservedReference) {
      try {
        const { environment } = await import("../_shared/server.ts");
        const env = environment();
        await fetch(
          `${env.url}/rest/v1/payment_attempts?reference=eq.${reservedReference}&state=eq.initializing`,
          {
            method: "PATCH",
            headers: env.headers,
            body: JSON.stringify({ state: "failed" }),
          },
        );
      } catch {
        /* An interrupted reservation can be retried after its short expiry. */
      }
    }
    return failure(error);
  }
});
