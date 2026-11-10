import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set(["https://trikonicimports.com", "https://www.trikonicimports.com"]);
function corsHeaders(origin: string | null) {
  const headers = new Headers({ "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Content-Type": "application/json" });
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}
const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in to pay for this order." }, 401, origin);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const paystackKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
  if (!paystackKey || !serviceKey) return json({ error: "Online payment is being set up. Please try again shortly." }, 503, origin);

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: auth } });
  if (!userResponse.ok) return json({ error: "Your session has expired. Sign in and try again." }, 401, origin);
  const user = await userResponse.json();
  let body: { orderNumber?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400, origin); }
  const orderNumber = String(body.orderNumber || "").trim();
  if (!orderNumber || !user.email) return json({ error: "Order or account email is missing." }, 400, origin);

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const orderUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
  orderUrl.searchParams.set("order_number", `eq.${orderNumber}`);
  orderUrl.searchParams.set("user_id", `eq.${user.id}`);
  orderUrl.searchParams.set("select", "id,order_number,estimated_total,currency,status,payment_status");
  const orderResponse = await fetch(orderUrl, { headers });
  const rows = orderResponse.ok ? await orderResponse.json() : [];
  const order = rows[0];
  if (!order) return json({ error: "We couldn't find that order in your account." }, 404, origin);
  if (order.status === "Order Cancelled") return json({ error: "Cancelled orders cannot be paid." }, 409, origin);
  if (order.payment_status === "paid") return json({ error: "This order is already paid." }, 409, origin);
  const amount = Math.round(Number(order.estimated_total) * 100);
  if (!Number.isSafeInteger(amount) || amount < 1 || order.currency !== "GHS") return json({ error: "This order has an invalid payment amount." }, 400, origin);

  const reference = `TRK-${crypto.randomUUID()}`;
  const callback = "https://trikonicimports.com/?payment=return#home";
  const initResponse = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${paystackKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      amount,
      currency: "GHS",
      reference,
      callback_url: callback,
      metadata: { order_number: order.order_number, order_id: order.id, user_id: user.id },
    }),
  });
  const initialized = await initResponse.json();
  if (!initResponse.ok || !initialized.status || !initialized.data?.authorization_url) {
    console.error("Paystack initialization failed", initialized.message || initResponse.status);
    return json({ error: "We couldn't start payment. Please retry from your account." }, 502, origin);
  }
  const updateUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
  updateUrl.searchParams.set("id", `eq.${order.id}`);
  const update = await fetch(updateUrl, { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ payment_reference: reference, payment_status: "pending" }) });
  if (!update.ok) {
    console.error("Could not save payment reference", await update.text());
    return json({ error: "Payment setup did not finish. Please try again." }, 502, origin);
  }
  return json({ authorizationUrl: initialized.data.authorization_url }, 200, origin);
});
