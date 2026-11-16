import { rateLimit } from "../_shared/limits.ts";
const assert = (v: unknown) => {
  if (!v) throw new Error("Assertion failed");
};
const realFetch = fetch;
Deno.env.set("SUPABASE_URL", "https://backend.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "server-secret");
Deno.test("durable limiter uses keyed identifiers and fails closed on rejection", async () => {
  let allow = true;
  globalThis.fetch = async (input, init: any) => {
    assert(
      String(input) ===
        "https://backend.test/rest/v1/rpc/consume_request_limit",
    );
    const body = JSON.parse(init.body);
    assert(!JSON.stringify(body).includes("ama@example.test"));
    assert(/^[0-9a-f]{64}$/.test(body.p_key));
    return Response.json(allow);
  };
  try {
    await rateLimit("contact", "ama@example.test", 5, 3600);
    allow = false;
    let status = 0;
    try {
      await rateLimit("contact", "ama@example.test", 5, 3600);
    } catch (error: any) {
      status = error.status;
    }
    assert(status === 429);
  } finally {
    globalThis.fetch = realFetch;
  }
});
Deno.test("cancellation ignores caller-selected scripts and runs in the private database", async () => {
  let handler: (r: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
  }) as typeof Deno.serve;
  let owned = true, calls = 0;
  globalThis.fetch = async (input, init: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: "customer-1",
        email: "ama@example.test",
        email_confirmed_at: "2026-01-01",
      });
    }
    if (url.pathname === "/rest/v1/rpc/consume_request_limit") {
      return Response.json(true);
    }
    assert(url.pathname === "/rest/v1/rpc/cancel_customer_order");
    const body = JSON.parse(init.body);
    assert(body.p_user === "customer-1");
    calls++;
    return owned
      ? Response.json({ ok: true, status: "Order Cancelled" })
      : Response.json({ code: "P0001", message: "Order not found" }, {
        status: 400,
      });
  };
  try {
    await import("../customer-cancel-order/index.ts");
    const request = () =>
      new Request("https://backend.test/cancel", {
        method: "POST",
        headers: { Authorization: "Bearer user-token" },
        body: JSON.stringify({
          orderNumber: "TRK-1794816000000-TEST",
          appsScriptEndpoint:
            "https://script.google.com/macros/s/attacker/exec",
        }),
      });
    assert((await handler!(request())).status === 200 && calls === 1);
    owned = false;
    assert((await handler!(request())).status === 404);
  } finally {
    Deno.serve = serve;
    globalThis.fetch = realFetch;
  }
});
Deno.test("contact form rejects actual oversized bodies and enforces rate limits before email", async () => {
  let handler: (r: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
  }) as typeof Deno.serve;
  let mailCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes("/rpc/consume_request_limit")) {
      return Response.json(false);
    }
    mailCalls++;
    throw new Error("Email must not send");
  };
  try {
    await import("../contact-message/index.ts");
    const request = (body: string, origin = "https://trikonicimports.com") =>
      new Request("https://backend.test/contact", {
        method: "POST",
        headers: { Origin: origin },
        body,
      });
    assert((await handler!(request("{}", "https://evil.test"))).status === 403);
    assert(
      (await handler!(request(JSON.stringify({ message: "x".repeat(9000) }))))
        .status === 413,
    );
    assert(
      (await handler!(
        request(
          JSON.stringify({
            name: "Ama",
            email: "ama@example.test",
            subject: "Hello",
            message: "Help",
          }),
        ),
      )).status === 429,
    );
    assert(mailCalls === 0);
  } finally {
    Deno.serve = serve;
    globalThis.fetch = realFetch;
  }
});
