import {
  cors,
  customer,
  failure,
  json,
  readJson,
  RequestError,
  rows,
} from "../_shared/server.ts";
import { rpc } from "../_shared/operations.ts";
import { rateLimit } from "../_shared/limits.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const { user } = await customer(request);
    await rateLimit("shipment-tracking", user.id, 60, 60);
    const { orderNumber } = await readJson(request, 4096);
    if (typeof orderNumber !== "string") {
      throw new RequestError("Invalid order number.");
    }
    const [order] = await rows("orders", {
      order_number: `eq.${orderNumber}`,
      user_id: `eq.${user.id}`,
      select: "id",
    });
    if (!order) throw new RequestError("Order not found.", 404);
    return json(
      await rpc("customer_shipment_tracking", {
        p_user: user.id,
        p_order: order.id,
      }),
    );
  } catch (error) {
    return failure(error);
  }
});
