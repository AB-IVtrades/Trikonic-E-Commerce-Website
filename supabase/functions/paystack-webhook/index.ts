import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { receiptFilename, receiptHtml, savedReceiptPdf, toBase64 } from "../_shared/receipt.ts";

import { orderForReference, verifyAndRecord } from "../_shared/payments.ts";
import { RequestError } from "../_shared/server.ts";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const encoder = new TextEncoder();

async function signatureFor(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function signatureForTimestamp(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function ghanaPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits)) return `233${digits.slice(1)}`;
  if (/^233\d{9}$/.test(digits)) return digits;
  return "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
  const webhookSigningSecret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET") || "";
  const paystackSignature = req.headers.get("paystack-signature") || "";
  const legacySignature = req.headers.get("x-paystack-signature") || "";
  if (!paystackKey) return reply({ error: "Webhook is not configured" }, 503);
  const rawBody = await req.text();
  let signatureValid = false;
  if (webhookSigningSecret && paystackSignature) {
    let timestamp = "";
    const candidates: string[] = [];
    for (const part of paystackSignature.split(",")) {
      const separator = part.indexOf("=");
      if (separator < 0) continue;
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (key === "t") timestamp = value;
      if (key === "v1") {
        const colon = value.indexOf(":");
        if (colon >= 0) candidates.push(value.slice(colon + 1).toLowerCase());
      }
    }
    const sentAt = Number(timestamp);
    if (/^\d+$/.test(timestamp) && Number.isFinite(sentAt) && Math.abs(Math.floor(Date.now() / 1000) - sentAt) <= 300) {
      const expected = await signatureForTimestamp(webhookSigningSecret, timestamp, rawBody);
      signatureValid = candidates.some((candidate) => /^[0-9a-f]{128}$/.test(candidate) && constantTimeEqual(candidate, expected));
    }
  }
  // Keep accepting the legacy signature only while Paystack sends it. Once the
  // dashboard signing secret is configured, the timestamped header is preferred.
  if (!signatureValid && legacySignature) {
    const expected = await signatureFor(paystackKey, rawBody);
    signatureValid = constantTimeEqual(legacySignature.toLowerCase(), expected);
  }
  if (!signatureValid) return reply({ error: "Invalid signature" }, 401);

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return reply({ error: "Invalid JSON" }, 400); }
  if (event.event !== "charge.success") return reply({ received: true });
  const reference = String(event.data?.reference || "");
  if (!reference) return reply({ received: true });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) return reply({ error: "Payment webhook is not configured" }, 503);
  const apiHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  let order;
  try {
    const record = await orderForReference(reference);
    if (!record) return reply({ received: true });
    if (!["pending", "paid"].includes(record.order.payment_status)) return reply({ received: true });
    const verified = await verifyAndRecord(reference, record);
    if (verified.state !== "success") return reply({ error: "Payment is not yet confirmed; verification will retry" }, 503);
    order = verified.order;
  } catch (error) {
    console.error("Payment verification failed", error instanceof Error ? error.message : "Unknown error");
    return reply({ error: "Payment could not be verified" }, error instanceof RequestError ? error.status : 503);
  }

  // Keep the Sheet aligned with the verified payment. Apps Script treats this
  // action idempotently and only advances an order still at Order Received.
  const appsScriptUrl = Deno.env.get("APPS_SCRIPT_ORDER_ENDPOINT") || "";
  const statusToken = Deno.env.get("ORDER_STATUS_SYNC_TOKEN") || "";
  if (!appsScriptUrl || !statusToken) return reply({ error: "Payment confirmed; spreadsheet sync is not configured yet" }, 503);
  try {
    const sheetResponse = await fetch(appsScriptUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "paymentMade", token: statusToken, orderNumber: order.order_number }) });
    const result = await sheetResponse.json().catch(() => ({}));
    if (!sheetResponse.ok || !result.ok) { console.error("Could not update payment status in Sheet", result); return reply({ error: "Payment confirmed; spreadsheet sync will retry" }, 503); }
  } catch (error) { console.error("Sheet payment status sync failed", error); return reply({ error: "Payment confirmed; spreadsheet sync will retry" }, 503); }

  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("TRIKONIC_FROM_EMAIL") || "Trikonic Imports <orders@trikonicimports.com>";
  if (!resendKey || !order.customer_email) return reply({ error: "Payment confirmed; email notification is not configured yet" }, 503);
  if (!order.email_notified_at) {
    let receipt;
    try { receipt = await savedReceiptPdf(order, supabaseUrl, serviceKey); }
    catch (error) { console.error("Receipt generation failed", error); return reply({ error: "Payment saved; receipt will retry" }, 503); }
    const email = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `paid-order-${order.order_number}` },
      body: JSON.stringify({
        from, to: [order.customer_email], subject: `Payment received · ${order.order_number}`,
        html: receiptHtml(order),
        attachments: [{ filename: receiptFilename(order), content: toBase64(receipt), content_type: "application/pdf" }],
      }),
    });
    if (!email.ok) { console.error("Resend notification failed", await email.text()); return reply({ error: "Payment saved; email notification will retry" }, 503); }
    await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, { method: "PATCH", headers: { ...apiHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ email_notified_at: new Date().toISOString() }) });
  }

  const smsClientId = Deno.env.get("HUBTEL_SMS_CLIENT_ID") || "";
  const smsClientSecret = Deno.env.get("HUBTEL_SMS_CLIENT_SECRET") || "";
  const senderId = Deno.env.get("HUBTEL_SMS_SENDER_ID") || "";
  const phone = ghanaPhone(String(order.contact || ""));
  if (smsClientId && smsClientSecret && senderId && phone && !order.sms_notified_at) {
    const basic = btoa(`${smsClientId}:${smsClientSecret}`);
    const sms = await fetch("https://sms.hubtel.com/v1/messages/send", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      body: JSON.stringify({ From: senderId, To: phone, Content: `Trikonic: payment received for ${order.order_number}. Track it in your account. Shipping is included in the amount paid.` }),
    });
    const result = await sms.json().catch(() => ({}));
    if (!sms.ok || Number(result.status) !== 0) { console.error("Hubtel SMS notification failed", result); return reply({ error: "Payment saved; SMS notification will retry" }, 503); }
    await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${order.id}`, { method: "PATCH", headers: { ...apiHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ sms_notified_at: new Date().toISOString() }) });
  }
  return reply({ received: true });
});
