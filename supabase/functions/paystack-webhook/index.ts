import { rpc } from "../_shared/operations.ts";
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const encoder = new TextEncoder();

async function signatureFor(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function signatureForTimestamp(
  secret: string,
  timestamp: string,
  body: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${timestamp}.${body}`),
    ),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
  const webhookSigningSecret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET") || "";
  const paystackSignature = req.headers.get("paystack-signature") || "";
  const legacySignature = req.headers.get("x-paystack-signature") || "";
  if (!paystackKey) return reply({ error: "Webhook is not configured" }, 503);
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > 1000000) {
    return reply({ error: "Request too large" }, 413);
  }
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
    if (
      /^\d+$/.test(timestamp) && Number.isFinite(sentAt) &&
      Math.abs(Math.floor(Date.now() / 1000) - sentAt) <= 300
    ) {
      const expected = await signatureForTimestamp(
        webhookSigningSecret,
        timestamp,
        rawBody,
      );
      signatureValid = candidates.some((candidate) =>
        /^[0-9a-f]{128}$/.test(candidate) &&
        constantTimeEqual(candidate, expected)
      );
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
  try {
    event = JSON.parse(rawBody);
  } catch {
    return reply({ error: "Invalid JSON" }, 400);
  }
  if (event.event !== "charge.success") return reply({ received: true });
  const reference = String(event.data?.reference || "");
  if (!reference) return reply({ received: true });

  try {
    await rpc("enqueue_payment_check", { p_reference: reference });
    return reply({ received: true });
  } catch {
    return reply(
      { error: "Payment check could not be queued; retry required" },
      503,
    );
  }
});
