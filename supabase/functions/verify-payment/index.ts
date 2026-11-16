import { rateLimit } from "../_shared/limits.ts";
import {
  cors,
  customer,
  failure,
  json,
  readJson,
  RequestError,
} from "../_shared/server.ts";
import { orderForReference, verifyAndRecord } from "../_shared/payments.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const { user } = await customer(request);
    await rateLimit("verify-payment", user.id, 60, 60);
    const { reference } = await readJson(request);
    if (
      typeof reference !== "string" || !/^[A-Za-z0-9-]{8,120}$/.test(reference)
    ) throw new RequestError("Missing or invalid payment reference.");
    const record = await orderForReference(reference, user.id);
    if (!record) {
      throw new RequestError(
        "This payment was not found in your account.",
        404,
      );
    }
    const result = await verifyAndRecord(reference, record);
    return json({
      status: result.state,
      orderNumber: result.order.order_number,
      amount: Number(result.order.estimated_total),
      currency: result.order.currency,
    });
  } catch (error) {
    return failure(error);
  }
});
