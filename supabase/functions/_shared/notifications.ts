import { environment, RequestError } from "./server.ts";
import {
  receiptFilename,
  receiptHtml,
  savedReceiptPdf,
  toBase64,
} from "./receipt.ts";
export async function sendPaidReceipt(order: any) {
  if (order.payment_status !== "paid") {
    throw new RequestError("Receipt requires verified payment.", 409);
  }
  if (order.email_notified_at) return;
  const env = environment(), key = Deno.env.get("RESEND_API_KEY");
  if (!key || !order.customer_email) {
    throw new RequestError("Receipt delivery is not configured.", 503);
  }
  const pdf = await savedReceiptPdf(order, env.url, env.key);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `paid-order-${order.order_number}`,
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      from: Deno.env.get("TRIKONIC_FROM_EMAIL") ||
        "Trikonic Imports <orders@trikonicimports.com>",
      to: [order.customer_email],
      subject: `Payment received · ${order.order_number}`,
      html: receiptHtml(order),
      attachments: [{
        filename: receiptFilename(order),
        content: toBase64(pdf),
        content_type: "application/pdf",
      }],
    }),
  });
  if (!response.ok) {
    throw new RequestError(
      "Receipt provider is unavailable; delivery will retry.",
      503,
    );
  }
  const saved = await fetch(`${env.url}/rest/v1/orders?id=eq.${order.id}`, {
    method: "PATCH",
    headers: env.headers,
    body: JSON.stringify({ email_notified_at: new Date().toISOString() }),
  });
  if (!saved.ok) {
    throw new RequestError("Receipt delivery confirmation will retry.", 503);
  }
}
