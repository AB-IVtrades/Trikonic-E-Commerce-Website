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
Deno.test("cancellation cannot redirect a server token to a caller-selected script", async () => {
  let handler: (r: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
  }) as typeof Deno.serve;
  Deno.env.set("ORDER_STATUS_SYNC_TOKEN", "sync-secret");
  Deno.env.set(
    "APPS_SCRIPT_ORDER_ENDPOINT",
    "https://script.google.com/macros/s/trusted/exec",
  );
  let owned = true, scriptCalls = 0;
  globalThis.fetch = async (input, init: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/rpc/consume_request_limit") {
      return Response.json(true);
    }
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: "customer-1" });
    }
    if (url.pathname === "/rest/v1/orders") {
      assert(url.searchParams.get("user_id") === "eq.customer-1");
      return Response.json(
        owned
          ? [{
            id: "order-1",
            user_id: "customer-1",
            status: init?.method === "PATCH"
              ? "Order Cancelled"
              : "Order Received",
          }]
          : [],
      );
    }
    assert(url.href === "https://script.google.com/macros/s/trusted/exec");
    assert(JSON.parse(init.body).token === "sync-secret");
    scriptCalls++;
    return Response.json({ ok: true });
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
    assert((await handler!(request())).status === 200 && scriptCalls === 1);
    owned = false;
    assert((await handler!(request())).status === 404 && scriptCalls === 1);
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
