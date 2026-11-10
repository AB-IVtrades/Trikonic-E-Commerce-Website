import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
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
  const lookup = new URL(`${supabaseUrl}/rest/v1/orders`);
  lookup.searchParams.set("payment_reference", `eq.${reference}`);
  lookup.searchParams.set("select", "id,order_number,user_id,customer_email,contact,estimated_total,currency,status,payment_status,email_notified_at,sms_notified_at");
  const foundResponse = await fetch(lookup, { headers: apiHeaders });
  if (!foundResponse.ok) return reply({ error: "Could not load payment order" }, 503);
  const orders = await foundResponse.json();
  const order = orders[0];
  if (!order) return reply({ received: true });

  // Verify transaction with Paystack and compare its amount and currency with
  // the server-side order before recording payment.
  const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${paystackKey}` } });
  const verified = await verifyResponse.json();
  const expectedAmount = Math.round(Number(order.estimated_total) * 100);
  if (!verifyResponse.ok || !verified.status || verified.data?.status !== "success" || verified.data?.currency !== order.currency || Number(verified.data?.amount) !== expectedAmount || verified.data?.reference !== reference) {
    console.error("Paystack verification mismatch", reference);
    return reply({ error: "Payment verification failed" }, 400);
  }
  if (order.payment_status !== "paid") {
    const paidAt = verified.data.paid_at || new Date().toISOString();
    const patchUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
    patchUrl.searchParams.set("id", `eq.${order.id}`);
    patchUrl.searchParams.set("payment_status", "eq.pending");
    const patchResponse = await fetch(patchUrl, {
      method: "PATCH",
      headers: { ...apiHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ payment_status: "paid", payment_paid_at: paidAt, status: order.status === "Order Received" ? "Payment Made" : order.status }),
    });
    if (!patchResponse.ok) return reply({ error: "Could not record payment" }, 503);
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
    const email = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `paid-order-${order.order_number}` },
      body: JSON.stringify({
        from, to: [order.customer_email], subject: `Payment received · ${order.order_number}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#123451"><p style="letter-spacing:.12em;color:#07805e">TRIKONIC IMPORTS</p><h1>Payment received</h1><p>We’ve confirmed your payment for order <strong>${escapeHtml(order.order_number)}</strong>.</p><p>Amount paid: <strong>GH₵${Number(order.estimated_total).toFixed(2)}</strong></p><p>You can track the order from <a href="https://trikonicimports.com/#home">your Trikonic account</a>. Shipping is included in the amount paid.</p></div>`,
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
