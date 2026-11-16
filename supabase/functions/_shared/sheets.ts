import { RequestError } from "./server.ts";
export async function syncOrderSheet(order: any) {
  const endpoint = Deno.env.get("APPS_SCRIPT_ORDER_ENDPOINT") || "";
  const token = Deno.env.get("ORDER_STATUS_SYNC_TOKEN") || "";
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new RequestError("The order spreadsheet is unavailable.", 503);
  }
  if (
    !token || url.protocol !== "https:" ||
    url.hostname !== "script.google.com" ||
    !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)
  ) throw new RequestError("The order spreadsheet is unavailable.", 503);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      action: "createOrder",
      token,
      orderId: order.order_number,
      createdAt: order.created_at,
      customer: {
        name: order.customer_name,
        contact: order.contact,
        location: order.delivery_area,
        notes: order.notes,
      },
      items: order.items,
      estimatedTotal: Number(order.estimated_total),
      currency: order.currency,
      shippingTotal: order.items?.some((i: any) => i.shippingTotal != null)
        ? order.items.reduce(
          (sum: number, i: any) =>
            sum + Math.round((i.shippingTotal || 0) * 100),
          0,
        ) / 100
        : null,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) {
    throw new RequestError(
      "Your order is saved, but its spreadsheet sync needs a retry. Open your account and continue payment shortly.",
      503,
    );
  }
}
