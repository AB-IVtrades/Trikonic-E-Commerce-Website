import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CANCELLABLE_STATUSES = new Set(["Order Received", "Payment Made", "Order Placed"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  const userToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!userToken) return json({ error: "Please sign in to cancel an order." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const statusSyncToken = Deno.env.get("ORDER_STATUS_SYNC_TOKEN") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !statusSyncToken) {
    console.error("Cancellation function is missing server configuration.");
    return json({ error: "Order cancellation is temporarily unavailable." }, 500);
  }

  // Resolve the supplied JWT to a user; never trust an order ID by itself.
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${userToken}` },
  });
  if (!userResponse.ok) return json({ error: "Your sign-in has expired. Please sign in again." }, 401);
  const user = await userResponse.json();
  if (typeof user.id !== "string") return json({ error: "Could not verify your account." }, 401);

  let payload: { orderNumber?: unknown; appsScriptEndpoint?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const orderNumber = typeof payload.orderNumber === "string" ? payload.orderNumber.trim() : "";
  const endpoint = typeof payload.appsScriptEndpoint === "string" ? payload.appsScriptEndpoint.trim() : "";
  if (!/^TRK-[0-9]{13}-[A-Z0-9]{4}$/.test(orderNumber)) return json({ error: "Invalid order number." }, 400);
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return json({ error: "The order spreadsheet connection is not configured." }, 503);
  }
  if (endpointUrl.protocol !== "https:" || endpointUrl.hostname !== "script.google.com" || !/^\/macros\/s\/[^/]+\/exec$/.test(endpointUrl.pathname)) {
    return json({ error: "The order spreadsheet connection is not configured correctly." }, 503);
  }

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  const lookupUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
  lookupUrl.searchParams.set("select", "id,user_id,status");
  lookupUrl.searchParams.set("order_number", `eq.${orderNumber}`);
  lookupUrl.searchParams.set("user_id", `eq.${user.id}`);
  lookupUrl.searchParams.set("limit", "1");
  const lookup = await fetch(lookupUrl, { headers });
  if (!lookup.ok) return json({ error: "Could not check this order. Please try again." }, 500);
  const orders = await lookup.json();
  const order = Array.isArray(orders) ? orders[0] : null;
  if (!order) return json({ error: "We couldn’t find that order in your account." }, 404);
  if (order.status === "Order Cancelled") return json({ ok: true, unchanged: true, status: order.status });
  if (!CANCELLABLE_STATUSES.has(order.status)) {
    return json({ error: "This order can’t be cancelled because it has already shipped or completed." }, 409);
  }

  // Google Apps Script rechecks the sheet status while holding a lock, then changes its Status cell.
  let sheetResponse: Response;
  try {
    sheetResponse = await fetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ action: "cancelOrder", orderNumber, token: statusSyncToken }),
      redirect: "follow",
    });
  } catch (error) {
    console.error("Apps Script cancellation request failed.", error);
    return json({ error: "The spreadsheet could not be reached. The order was not cancelled; please try again." }, 502);
  }
  let sheetResult: { ok?: boolean; error?: string } = {};
  try {
    sheetResult = await sheetResponse.json();
  } catch {
    return json({ error: "The spreadsheet returned an unexpected response. The order was not cancelled." }, 502);
  }
  if (!sheetResponse.ok || !sheetResult.ok) {
    return json({ error: sheetResult.error || "The spreadsheet could not update this order. The order was not cancelled." }, 409);
  }

  // Compare-and-set prevents cancellation if the order status changed during the request.
  const updateUrl = new URL(`${supabaseUrl}/rest/v1/orders`);
  updateUrl.searchParams.set("id", `eq.${order.id}`);
  updateUrl.searchParams.set("user_id", `eq.${user.id}`);
  updateUrl.searchParams.set("status", `eq.${order.status}`);
  updateUrl.searchParams.set("select", "id,status");
  const update = await fetch(updateUrl, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ status: "Order Cancelled" }),
  });
  if (!update.ok) return json({ error: "The spreadsheet was updated, but order tracking could not be refreshed. Please contact us." }, 502);
  const updatedRows = await update.json();
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    const currentResponse = await fetch(lookupUrl, { headers });
    const currentRows = currentResponse.ok ? await currentResponse.json() : [];
    if (Array.isArray(currentRows) && currentRows[0]?.status === "Order Cancelled") {
      return json({ ok: true, unchanged: true, status: "Order Cancelled" });
    }
    return json({ error: "The order status changed while cancellation was processing. Refresh your order history." }, 409);
  }
  return json({ ok: true, status: "Order Cancelled" });
});
