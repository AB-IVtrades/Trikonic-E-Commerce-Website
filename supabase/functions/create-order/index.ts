import {
  cors,
  customer,
  failure,
  json,
  RequestError,
} from "../_shared/server.ts";
import { loadCatalog, priceOrder } from "../_shared/catalog.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const { user, env } = await customer(request);
    const payload = await request.json();
    const setting = await fetch(
      `${env.url}/rest/v1/site_settings?id=eq.1&select=maintenance_mode`,
      { headers: env.headers },
    );
    if (!setting.ok) {
      throw new RequestError("Could not check storefront status.", 503);
    }
    const [store] = await setting.json();
    if (store?.maintenance_mode && user.app_metadata?.store_role !== "admin") {
      throw new RequestError(
        "The store is temporarily closed. Please try again later.",
        409,
      );
    }
    const checked = priceOrder(payload.items, await loadCatalog());
    const clean = (value: unknown, limit: number) =>
      typeof value === "string" ? value.trim().slice(0, limit) : "";
    const name = clean(payload.customer?.name, 200),
      contact = clean(payload.customer?.contact, 200);
    if (!name || !contact) {
      throw new RequestError("Please enter your name and contact details.");
    }
    const id = clean(payload.orderId, 80);
    if (!/^TRK-[0-9]{13}-[A-Z0-9]{4}$/.test(id)) {
      throw new RequestError("Invalid order number.");
    }
    const response = await fetch(`${env.url}/rest/v1/orders`, {
      method: "POST",
      headers: { ...env.headers, Prefer: "return=representation" },
      body: JSON.stringify({
        order_number: id,
        user_id: user.id,
        customer_name: name,
        customer_email: user.email.toLowerCase(),
        contact,
        delivery_area: clean(payload.customer?.location, 500),
        notes: clean(payload.customer?.notes, 2000),
        items: checked.items,
        estimated_total: checked.total,
        currency: "GHS",
        status: "Order Received",
        pricing_verified_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      throw new RequestError(
        "Could not save your order. Please try again.",
        response.status === 409 ? 409 : 503,
      );
    }
    const [order] = await response.json();
    return json({
      order: {
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
        shippingTotal: order.items.some((i: any) => i.shippingTotal != null)
          ? order.items.reduce(
            (sum: number, i: any) =>
              sum + Math.round((i.shippingTotal || 0) * 100),
            0,
          ) / 100
          : null,
      },
    });
  } catch (error) {
    return failure(error);
  }
});
