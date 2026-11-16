import { environment, RequestError, rows } from "./server.ts";
import { rpc } from "./operations.ts";
export async function orderForReference(reference: string, userId?: string) {
  const attempts = await rows("payment_attempts", {
    reference: `eq.${reference}`,
    select: "*",
  });
  const attempt = attempts[0];
  const filters: Record<string, string> = attempt
    ? { id: `eq.${attempt.order_id}` }
    : { payment_reference: `eq.${reference}` };
  if (userId) filters.user_id = `eq.${userId}`;
  const [order] = await rows("orders", { ...filters, select: "*" });
  if (!order) return null;
  return { order, attempt };
}
export async function verifyAndRecord(reference: string, record: any) {
  const { order, attempt } = record, env = environment();
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) {
    throw new RequestError("Payment verification is unavailable.", 503);
  }
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${
      encodeURIComponent(reference)
    }`,
    {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  const result = await response.json();
  if (!response.ok || result.status !== true || !result.data) {
    throw new RequestError(
      "Could not verify this payment. Please try again.",
      503,
    );
  }
  const tx = result.data,
    amount = Math.round(Number(order.estimated_total) * 100);
  if (
    !Number.isSafeInteger(amount) || amount < 1 || tx.reference !== reference ||
    tx.currency !== order.currency || order.currency !== "GHS" ||
    Number(tx.amount) !== amount ||
    (attempt &&
      (Number(attempt.amount) !== amount || attempt.currency !== tx.currency))
  ) {
    throw new RequestError(
      "Payment details do not match this order. Please contact us.",
      409,
    );
  }
  if (
    (!tx.customer?.email ||
      tx.customer.email.toLowerCase() !== order.customer_email?.toLowerCase())
  ) throw new RequestError("Payment customer does not match the order.", 409);
  if (
    tx.metadata && typeof tx.metadata === "object" &&
    ((tx.metadata.order_id && tx.metadata.order_id !== order.id) ||
      (tx.metadata.user_id && tx.metadata.user_id !== order.user_id))
  ) throw new RequestError("Payment does not belong to this order.", 409);
  if (tx.status !== "success") {
    const failed = ["failed", "abandoned", "reversed"].includes(tx.status);
    if (failed && attempt) {
      await fetch(
        `${env.url}/rest/v1/payment_attempts?reference=eq.${
          encodeURIComponent(reference)
        }&state=neq.paid`,
        {
          method: "PATCH",
          headers: env.headers,
          body: JSON.stringify({ state: "failed" }),
        },
      );
    }
    return { state: failed ? "failed" : "pending", order };
  }
  const saved = await rpc("finalize_verified_payment", {
    p_order: order.id,
    p_reference: reference,
    p_transaction: tx,
  });
  Object.assign(order, saved);
  return { state: "success", order };
}
