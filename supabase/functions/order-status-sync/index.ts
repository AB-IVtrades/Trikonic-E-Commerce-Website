import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_STATUSES = new Set(["New", "Confirmed", "Preparing", "In Transit", "Delivered", "Cancelled"]);

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedToken = Deno.env.get("ORDER_STATUS_SYNC_TOKEN") ?? "";
  const suppliedToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!expectedToken || !suppliedToken || !safeEqual(suppliedToken, expectedToken)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > 4096) return json({ error: "Request too large" }, 413);

  let payload: { orderNumber?: unknown; status?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const orderNumber = typeof payload.orderNumber === "string" ? payload.orderNumber.trim() : "";
  const status = typeof payload.status === "string" ? payload.status.trim() : "";
  if (!/^TRK-[0-9]{13}-[A-Z0-9]{4}$/.test(orderNumber)) return json({ error: "Invalid order number" }, 400);
  if (!ALLOWED_STATUSES.has(status)) return json({ error: "Unsupported order status" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration unavailable" }, 500);

  const apiHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const lookupUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
  lookupUrl.searchParams.set("select", "id,status");
  lookupUrl.searchParams.set("order_number", `eq.${orderNumber}`);
  lookupUrl.searchParams.set("limit", "1");
  const lookup = await fetch(lookupUrl, { headers: apiHeaders });
  if (!lookup.ok) return json({ error: "Could not find the order" }, 500);
  const orders = await lookup.json();
  const order = Array.isArray(orders) ? orders[0] : null;
  if (!order) return json({ error: "Order not found" }, 404);
  if (order.status === status) return json({ ok: true, unchanged: true });

  const updateUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
  updateUrl.searchParams.set("order_number", `eq.${orderNumber}`);
  const update = await fetch(updateUrl, {
    method: "PATCH",
    headers: { ...apiHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ status }),
  });
  if (!update.ok) return json({ error: "Could not update the order status" }, 500);

  return json({ ok: true, status });
});
