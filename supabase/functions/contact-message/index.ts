import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set(["https://trikonicimports.com", "https://www.trikonicimports.com"]);
const recipient = "trikonic1011@gmail.com";

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json"
  });
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (!origin || !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 8_000) return json({ error: "Message is too large" }, 413, origin);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "Invalid request" }, 400, origin); }
  // Quietly accept the hidden honeypot field so simple bots don't retry.
  if (clean(payload.website, 200)) return json({ ok: true }, 200, origin);

  const name = clean(payload.name, 120);
  const email = clean(payload.email, 254).toLowerCase();
  const phone = clean(payload.phone, 32);
  const subject = clean(payload.subject, 120);
  const message = clean(payload.message, 500);
  if (!name || !subject || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please provide a valid name, email, subject, and message." }, 400, origin);
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("TRIKONIC_FROM_EMAIL") || "Trikonic Imports <orders@trikonicimports.com>";
  if (!apiKey) return json({ error: "Email service is not configured." }, 503, origin);
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safePhone = escapeHtml(phone || "Not provided");
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const text = `New contact message for Trikonic Imports\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\nSubject: ${subject}\n\nMessage:\n${message}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [recipient],
      reply_to: email,
      subject: `Trikonic website enquiry: ${subject}`,
      text,
      html: `<h2>New contact message</h2><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Phone:</strong> ${safePhone}</p><p><strong>Subject:</strong> ${safeSubject}</p><p><strong>Message:</strong><br>${safeMessage}</p>`
    })
  });
  if (!response.ok) {
    console.error("Resend rejected contact email", response.status);
    return json({ error: "Email could not be sent." }, 502, origin);
  }
  return json({ ok: true }, 200, origin);
});
