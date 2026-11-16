import {
  environment,
  failure,
  json,
  readJson,
  RequestError,
  rows,
} from "../_shared/server.ts";
import { rpc } from "../_shared/operations.ts";
import { orderForReference, verifyAndRecord } from "../_shared/payments.ts";
import { sendPaidReceipt } from "../_shared/notifications.ts";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
export async function processJob(job: any) {
  let state = "done", message: string | null = null;
  try {
    if (Date.parse(job.deadline) <= Date.now()) {
      throw new RequestError(
        job.kind === "receipt"
          ? "Receipt needs review before another send (automatic deduplication window ended)."
          : "Payment is unresolved after 72 hours; review required.",
        409,
      );
    }
    if (job.kind === "payment") {
      const record = await orderForReference(job.job_key);
      if (!record) {
        throw new RequestError("Payment reference needs review.", 409);
      }
      const result = await verifyAndRecord(job.job_key, record);
      if (result.state === "pending") state = "queued";
    } else {
      const [order] = await rows("orders", {
        id: `eq.${job.order_id}`,
        select: "*",
      });
      if (!order) throw new RequestError("Order not found.", 409);
      await sendPaidReceipt(order);
    }
  } catch (error) {
    message = error instanceof Error ? error.message : "Order job failed";
    state = error instanceof RequestError && error.status === 409
      ? "attention"
      : "queued";
  }
  await rpc("finish_order_job", {
    p_id: job.id,
    p_lease: job.lease_token,
    p_state: state,
    p_error: message,
  });
  return state;
}
Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  try {
    const key = (request.headers.get("Authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    );
    if (
      !/^[0-9a-f]{64}$/.test(key) ||
      await rpc("authorize_order_worker", { p_token: key }) !== true
    ) throw new RequestError("Unauthorized", 401);
    const payload = await readJson(request, 4096);
    if (payload.job_id) {
      const job = await rpc("read_order_job", {
        p_id: payload.job_id,
        p_lease: payload.lease_token,
      });
      if (!job) return json({ skipped: true });
      return json({ state: await processJob(job) });
    }
    const jobs = await rpc("claim_order_jobs");
    const dispatch = async () => {
      const pending = [...jobs];
      const env = environment();
      await Promise.all(
        Array.from({ length: Math.min(4, pending.length) }, async () => {
          while (pending.length) {
            const job = pending.shift();
            try {
              const reply = await fetch(
                `${env.url}/functions/v1/process-order-jobs`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${key}`,
                  },
                  body: JSON.stringify({
                    job_id: job.id,
                    lease_token: job.lease_token,
                  }),
                  signal: AbortSignal.timeout(60000),
                },
              );
              if (!reply.ok) {
                console.error(
                  "Job invocation will recover after lease expiry",
                  job.id,
                  reply.status,
                );
              }
            } catch {
              console.error(
                "Job invocation interrupted; lease recovery pending",
                job.id,
              );
            }
          }
        }),
      );
    };
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(dispatch());
    else await dispatch();
    return json({ claimed: jobs.length });
  } catch (error) {
    return failure(error);
  }
});
