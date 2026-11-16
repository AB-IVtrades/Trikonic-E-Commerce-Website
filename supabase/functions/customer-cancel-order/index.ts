import {
  cors,
  customer,
  failure,
  json,
  readJson,
  RequestError,
} from "../_shared/server.ts";
import { rateLimit } from "../_shared/limits.ts";
import { rpc } from "../_shared/operations.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const { user } = await customer(request);
    await rateLimit("cancel-order", user.id, 20, 60);
    const { orderNumber } = await readJson(request, 4096);
    if (
      typeof orderNumber !== "string" ||
      !/^TRK-[0-9]{13}-[A-Z0-9]{4}$/.test(orderNumber)
    ) throw new RequestError("Invalid order number.");
    return json(
      await rpc("cancel_customer_order", {
        p_user: user.id,
        p_number: orderNumber,
      }),
    );
  } catch (error) {
    return failure(error);
  }
});
