import {
  cors,
  failure,
  json,
  readJson,
  RequestError,
  rows,
} from "../_shared/server.ts";
import { administrator, rpc } from "../_shared/operations.ts";
import { rateLimit } from "../_shared/limits.ts";
import { orderForReference, verifyAndRecord } from "../_shared/payments.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const payload = await readJson(request);
    const access = payload.action === "access";
    const { user, aal } = await administrator(request, !access);
    if (access) {
      return json({
        admin: true,
        mfaRequired: aal !== "aal2",
        paymentMode: Deno.env.get("PAYSTACK_SECRET_KEY")?.startsWith("sk_test_")
          ? "test"
          : "live",
      });
    }
    await rateLimit("admin-orders", user.id, 120, 60);
    if (payload.action === "recheck") {
      const [order] = await rows("orders", {
        id: `eq.${String(payload.id)}`,
        select: "*",
      });
      if (!order) throw new RequestError("Order not found.", 404);
      const reference = String(
        payload.reference || order.confirmed_reference ||
          order.payment_reference || "",
      );
      if (!reference) {
        throw new RequestError("This order has no payment attempt to check.");
      }
      const record = await orderForReference(reference);
      if (!record || record.order.id !== order.id) {
        throw new RequestError("Reference does not belong to this order.");
      }
      await rpc("order_operations", {
        p_actor: user.id,
        p_action: "audit_recheck",
        p_data: { id: order.id },
      });
      const result = await verifyAndRecord(reference, record);
      return json({ status: result.state });
    }
    if (!["orders", "detail"].includes(payload.action)) {
      throw new RequestError("Invalid action.");
    }
    return json(
      await rpc("order_operations", {
        p_actor: user.id,
        p_action: payload.action,
        p_data: payload,
      }),
    );
  } catch (error) {
    return failure(error);
  }
});
