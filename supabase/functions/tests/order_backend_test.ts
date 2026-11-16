import { administrator } from "../_shared/operations.ts";
import { sendPaidReceipt } from "../_shared/notifications.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("Assertion failed");
};
const realFetch = fetch;
Deno.env.set("SUPABASE_URL", "https://backend.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "server-secret");
Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test_mock");
function token(aal: string) {
  return `header.${
    btoa(JSON.stringify({ sub: "admin-1", aal })).replace(/=/g, "")
  }.signature`;
}
Deno.test("admin requires fresh server-controlled role and authenticated MFA assurance", async () => {
  let role = "admin";
  globalThis.fetch = async (input) => {
    assert(String(input) === "https://backend.test/auth/v1/user");
    return Response.json({
      id: "admin-1",
      email: "owner@example.test",
      email_confirmed_at: "2026-01-01",
      app_metadata: { store_role: role },
      user_metadata: { store_role: "admin" },
    });
  };
  const request = (aal: string) =>
    new Request("https://backend.test", {
      headers: { Authorization: `Bearer ${token(aal)}` },
    });
  try {
    assert((await administrator(request("aal2"))).user.id === "admin-1");
    let status = 0;
    try {
      await administrator(request("aal1"));
    } catch (e: any) {
      status = e.status;
    }
    assert(status === 403);
    assert((await administrator(request("aal1"), false)).aal === "aal1");
    role = "customer";
    status = 0;
    try {
      await administrator(request("aal2"));
    } catch (e: any) {
      status = e.status;
    }
    assert(status === 403);
  } finally {
    globalThis.fetch = realFetch;
  }
});
Deno.test("receipt provider outage preserves paid state and retries use a stable deduplication key", async () => {
  Deno.env.set("RESEND_API_KEY", "resend-test");
  let available = false, sends = 0, marked = 0;
  const keys: string[] = [];
  const order = {
    id: "order-1",
    order_number: "TRK-1794816000000-TEST",
    customer_name: "Ama",
    customer_email: "ama@example.test",
    payment_status: "paid",
    created_at: "2026-11-16",
    payment_paid_at: "2026-11-16",
    currency: "GHS",
    estimated_total: 100,
    items: [],
  };
  globalThis.fetch = async (input, init: any) => {
    const url = String(input);
    if (url.includes("/storage/v1/")) {
      return new Response(new Uint8Array([37, 80, 68, 70]));
    }
    if (url === "https://api.resend.com/emails") {
      sends++;
      keys.push(new Headers(init.headers).get("Idempotency-Key")!);
      return new Response("{}", { status: available ? 200 : 503 });
    }
    assert(url.includes("/rest/v1/orders"));
    assert(!("payment_status" in JSON.parse(init.body)));
    marked++;
    return Response.json({});
  };
  try {
    let rejected = false;
    try {
      await sendPaidReceipt(order);
    } catch {
      rejected = true;
    }
    assert(rejected && order.payment_status === "paid" && marked === 0);
    available = true;
    await sendPaidReceipt(order);
    assert(sends === 2 && marked === 1 && keys[0] === keys[1]);
    await sendPaidReceipt({ ...order, email_notified_at: "2026-11-16" });
    assert(sends === 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
Deno.test("worker recovers pending payments, stops expired jobs and keeps unauthenticated callers out", async () => {
  let handler: (r: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
  }) as typeof Deno.serve;
  let txStatus = "pending", finished: any, verified = 0;
  globalThis.fetch = async (input, init: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/payment_attempts") {
      return Response.json([{
        reference: "TRK-job-reference",
        order_id: "order-1",
        amount: 10000,
        currency: "GHS",
      }]);
    }
    if (url.pathname === "/rest/v1/orders") {
      return Response.json([{
        id: "order-1",
        user_id: "user-1",
        customer_email: "ama@example.test",
        payment_status: "pending",
        estimated_total: 100,
        currency: "GHS",
        pricing_verified_at: "2026-11-16",
      }]);
    }
    if (url.hostname === "api.paystack.co") {
      verified++;
      return Response.json({
        status: true,
        data: {
          status: txStatus,
          reference: "TRK-job-reference",
          amount: 10000,
          currency: "GHS",
          customer: { email: "ama@example.test" },
        },
      });
    }
    if (url.pathname.endsWith("/finish_order_job")) {
      finished = JSON.parse(init.body);
      return Response.json(null);
    }
    if (url.pathname.endsWith("/authorize_order_worker")) {
      return Response.json(false);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    const { processJob } = await import("../process-order-jobs/index.ts");
    const job = {
      id: "job-1",
      lease_token: "lease-1",
      kind: "payment",
      job_key: "TRK-job-reference",
      deadline: new Date(Date.now() + 60000).toISOString(),
    };
    assert(
      await processJob(job) === "queued" && finished.p_state === "queued" &&
        verified === 1,
    );
    assert(
      await processJob({ ...job, deadline: "2020-01-01" }) === "attention" &&
        verified === 1,
    );
    const response = await handler!(
      new Request("https://backend.test/worker", {
        method: "POST",
        headers: { Authorization: "Bearer public-key" },
        body: "{}",
      }),
    );
    assert(response.status === 401 && verified === 1);
  } finally {
    Deno.serve = serve;
    globalThis.fetch = realFetch;
  }
});
