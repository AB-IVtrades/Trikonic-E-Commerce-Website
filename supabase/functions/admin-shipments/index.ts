import {
  cors,
  failure,
  json,
  readJson,
  RequestError,
} from "../_shared/server.ts";
import { administrator, rpc } from "../_shared/operations.ts";
import { rateLimit } from "../_shared/limits.ts";
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const { user } = await administrator(request);
    await rateLimit("admin-shipments", user.id, 120, 60);
    const payload = await readJson(request);
    if (
      !["shipments", "create_shipment", "allocate", "unassign", "advance"]
        .includes(payload.action)
    ) throw new RequestError("Invalid action.");
    return json(
      await rpc("order_operations", {
        p_actor: user.id,
        p_action: payload.action,
        p_data: payload,
      }),
    );
  } catch (error) {
    return failure(error);
  }
});
