import { priceOrder } from "../_shared/catalog.ts";
import { orderForReference, verifyAndRecord } from "../_shared/payments.ts";
const assert = (value: unknown, message = "Assertion failed") => {
  if (!value) throw new Error(message);
};
const throws = (fn: () => unknown) => {
  let failed = false;
  try {
    fn();
  } catch {
    failed = true;
  }
  assert(failed);
};
const product = {
  id: "p1",
  name: "Trusted hair",
  category: "Hair",
  image: "images/hair.jpg",
  price: 100,
  shippingFee: 20,
  sizes: ["12 inches", '14"'],
  types: ["2 x 4", "4 x 4"],
  variantPrices: [{ color: "14 inches", size: "4x4", price: 250 }],
  availability: "preorder",
};
Deno.test("server prices ignore forged totals and enforce options, quantity, sale, shipping and stock", () => {
  const input = {
    id: "p1",
    size: '14"',
    variant: "4 x 4",
    quantity: 2,
    unitPrice: 1,
    lineTotal: 1,
    name: "Forged",
  };
  const checked = priceOrder([input], [product]);
  assert(
    checked.amount === 52000 && checked.items[0].unitPrice === 250 &&
      checked.items[0].name === "Trusted hair",
  );
  assert(
    priceOrder([input], [{ ...product, flashSale: true, salePrice: 200 }])
      .amount === 42000,
  );
  for (
    const item of [
      { ...input, size: "" },
      { ...input, variant: "6x6" },
      { ...input, quantity: 0 },
      { ...input, quantity: 1.5 },
      { ...input, quantity: "2" },
      { ...input, color: "Free" },
    ]
  ) throws(() => priceOrder([item], [product]));
  throws(() => priceOrder([input, input], [product]));
  throws(() => priceOrder([input], [{ ...product, stockQuantity: 1 }]));
  throws(() =>
    priceOrder([input], [{ ...product, availability: "out_of_stock" }])
  );
});
const order = {
  id: "order-1",
  user_id: "user-1",
  customer_email: "ama@example.test",
  order_number: "TRK-1794816000000-TEST",
  payment_status: "pending",
  status: "Order Received",
  estimated_total: 520,
  currency: "GHS",
  pricing_verified_at: "2026-11-16T00:00:00Z",
};
const attempt = {
  reference: "TRK-reference-123",
  order_id: "order-1",
  amount: 52000,
  currency: "GHS",
  state: "ready",
};
const tx = {
  reference: attempt.reference,
  status: "success",
  amount: 52000,
  currency: "GHS",
  customer: { email: order.customer_email },
  metadata: { order_id: order.id, user_id: order.user_id },
};
const realFetch = globalThis.fetch;
Deno.test("verification rejects mismatches, pending and failed never mark paid, success persists once", async () => {
  Deno.env.set("SUPABASE_URL", "https://backend.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "secret");
  Deno.env.set("PAYSTACK_SECRET_KEY", "test-secret");
  let transaction: any = { ...tx }, saved: any = { ...order }, paidWrites = 0;
  globalThis.fetch = async (input, init: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/rpc/consume_request_limit") {
      return Response.json(true);
    }
    if (url.hostname === "api.paystack.co") {
      return Response.json({ status: true, data: transaction });
    }
    if (url.pathname === "/rest/v1/rpc/finalize_verified_payment") {
      const body = JSON.parse(String(init.body));
      assert(body.p_transaction.status === "success");
      if (saved.payment_status !== "paid") paidWrites++;
      saved = { ...saved, payment_status: "paid", status: "Payment Made" };
      return Response.json(saved);
    }
    if (url.pathname === "/rest/v1/payment_attempts") return Response.json([]);
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    for (
      const change of [
        { amount: 1 },
        { currency: "USD" },
        { reference: "other-ref" },
        { customer: { email: "other@example.test" } },
        { metadata: { user_id: "other" } },
        { metadata: { order_id: "other" } },
      ]
    ) {
      transaction = { ...tx, ...change };
      let rejected = false;
      try {
        await verifyAndRecord(attempt.reference, {
          order: { ...order },
          attempt,
        });
      } catch {
        rejected = true;
      }
      assert(rejected);
      assert(paidWrites === 0);
    }
    for (const status of ["pending", "ongoing", "failed", "abandoned"]) {
      transaction = { ...tx, status };
      const r = await verifyAndRecord(attempt.reference, {
        order: { ...order },
        attempt,
      });
      assert(r.state !== "success" && paidWrites === 0);
    }
    transaction = { ...tx };
    const r = await verifyAndRecord(attempt.reference, {
      order: saved,
      attempt,
    });
    assert(
      r.state === "success" && saved.payment_status === "paid" &&
        saved.status === "Payment Made" && paidWrites === 1,
    );
    await verifyAndRecord(attempt.reference, { order: saved, attempt });
    assert(paidWrites === 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
Deno.test("callback endpoint authenticates, scopes reference to owner and returns verified result", async () => {
  let handler: (r: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
  }) as typeof Deno.serve;
  let owned = true, status = "pending", paidWrites = 0;
  globalThis.fetch = async (input, init: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/rpc/consume_request_limit") {
      return Response.json(true);
    }
    if (url.pathname === "/rest/v1/rpc/is_current_session_active") return Response.json(true);
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: "user-1",
        email: "ama@example.test",
        email_confirmed_at: "2026-01-01",
      });
    }
    if (url.pathname === "/rest/v1/payment_attempts") {
      return Response.json(init?.method === "PATCH" ? {} : [attempt]);
    }
    if (url.pathname === "/rest/v1/rpc/finalize_verified_payment") {
      paidWrites++;
      return Response.json({
        ...order,
        payment_status: "paid",
        status: "Payment Made",
      });
    }
    if (url.pathname === "/rest/v1/orders") {
      if (init?.method === "PATCH") {
        paidWrites++;
        return Response.json([{ ...order, payment_status: "paid" }]);
      }
      assert(url.searchParams.get("user_id") === "eq.user-1");
      return Response.json(owned ? [order] : []);
    }
    if (url.hostname === "api.paystack.co") {
      return Response.json({ status: true, data: { ...tx, status } });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await import("../verify-payment/index.ts");
    const request = (body: any, auth = true) =>
      new Request("https://backend.test/verify-payment", {
        method: "POST",
        headers: auth ? { Authorization: "Bearer user-token" } : {},
        body: JSON.stringify(body),
      });
    assert(
      (await handler!(request({ reference: attempt.reference }, false)))
        .status === 401,
    );
    assert((await handler!(request({ reference: "invalid" }))).status === 400);
    owned = false;
    assert(
      (await handler!(request({ reference: attempt.reference }))).status ===
        404,
    );
    owned = true;
    assert(
      (await (await handler!(request({ reference: attempt.reference }))).json())
            .status === "pending" && paidWrites === 0,
    );
    status = "success";
    assert(
      (await (await handler!(request({ reference: attempt.reference }))).json())
            .status === "success" && paidWrites === 1,
    );
  } finally {
    Deno.serve = serve;
    globalThis.fetch = realFetch;
  }
});
Deno.test("checkout uses confirmed customer and trusted catalog rather than client email or price", async () => {
  let handler: (r: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
  }) as typeof Deno.serve;
  Deno.env.set(
    "APPS_SCRIPT_ORDER_ENDPOINT",
    "https://script.google.com/macros/s/catalog/exec",
  );
  let inserted: any, maintenance = false;
  globalThis.fetch = async (input, init: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/rpc/consume_request_limit") {
      return Response.json(true);
    }
    if (url.pathname === "/rest/v1/rpc/is_current_session_active") return Response.json(true);
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: "user-1",
        email: "ama@example.test",
        email_confirmed_at: "2026-01-01",
      });
    }
    if (url.pathname === "/rest/v1/site_settings") {
      return Response.json([{ maintenance_mode: maintenance }]);
    }
    if (url.hostname === "script.google.com") {
      return new Response(
        `receiveTrikonicProducts(${
          JSON.stringify({ ready: true, products: [product] })
        })`,
      );
    }
    if (url.pathname === "/rest/v1/orders") {
      inserted = JSON.parse(String(init?.body));
      return Response.json([{ ...inserted, created_at: "2026-11-16" }]);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await import("../create-order/index.ts");
    const request = () =>
      new Request("https://backend.test/create-order", {
        method: "POST",
        headers: { Authorization: "Bearer user-token" },
        body: JSON.stringify({
          orderId: order.order_number,
          customer: {
            name: "Ama",
            contact: "0200000000",
            email: "thief@example.test",
          },
          items: [{
            id: "p1",
            size: '14"',
            variant: "4 x 4",
            quantity: 2,
            unitPrice: 1,
          }],
          estimatedTotal: 1,
        }),
      });
    const response = await handler!(request());
    assert(response.status === 200);
    assert(
      inserted.estimated_total === 520 &&
        inserted.customer_email === "ama@example.test" &&
        inserted.user_id === "user-1" && inserted.pricing_verified_at,
    );
    inserted = null;
    maintenance = true;
    assert((await handler!(request())).status === 409 && inserted === null);
  } finally {
    Deno.serve = serve;
    globalThis.fetch = realFetch;
  }
});
Deno.test("payment initialization uses saved amount, reserves before Paystack and reuses pending link", async () => {
  let handler: (r: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
  }) as typeof Deno.serve;
  let active: any, initialized = 0, mode = "normal";
  Deno.env.set("ORDER_STATUS_SYNC_TOKEN", "test-sync-token");
  globalThis.fetch = async (input, init: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/rpc/consume_request_limit") {
      return Response.json(true);
    }
    if (url.pathname === "/rest/v1/rpc/is_current_session_active") return Response.json(true);
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: "user-1",
        email: order.customer_email,
        email_confirmed_at: "2026-01-01",
      });
    }
    if (url.pathname === "/rest/v1/orders") {
      if (init?.method === "PATCH") {
        assert(!JSON.parse(init.body).payment_status);
        return Response.json({});
      }
      assert(url.searchParams.get("user_id") === "eq.user-1");
      return Response.json([{
        ...order,
        payment_status: mode === "paid" ? "paid" : "pending",
      }]);
    }
    if (url.pathname === "/rest/v1/payment_attempts") {
      if (init?.method === "POST") {
        if (active) return new Response("{}", { status: 409 });
        active = {
          ...JSON.parse(init.body),
          state: "initializing",
          created_at: new Date().toISOString(),
        };
        return Response.json({});
      }
      if (init?.method === "PATCH") {
        Object.assign(active, JSON.parse(init.body));
        return Response.json({});
      }
      return Response.json(active ? [active] : []);
    }
    if (url.hostname === "script.google.com") {
      return Response.json({ ok: true });
    }
    if (url.pathname === "/transaction/initialize") {
      const body = JSON.parse(init.body);
      assert(
        active.reference === body.reference && body.amount === 52000 &&
          body.currency === "GHS" && body.email === order.customer_email,
      );
      assert(
        body.callback_url ===
          "https://trikonicimports.com/?payment=return",
      );
      initialized++;
      return Response.json({
        status: true,
        data: {
          reference: body.reference,
          authorization_url: "https://checkout.paystack.com/test-link",
        },
      });
    }
    if (url.hostname === "api.paystack.co") {
      return Response.json({
        status: true,
        data: { ...tx, reference: active.reference, status: "pending" },
      });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await import("../initialize-paystack-payment/index.ts");
    const request = () =>
      new Request("https://backend.test/initialize", {
        method: "POST",
        headers: { Authorization: "Bearer user-token" },
        body: JSON.stringify({ orderNumber: order.order_number, amount: 1 }),
      });
    assert(
      (await handler!(request())).status === 200 && initialized === 1 &&
        active.state === "ready",
    );
    assert((await handler!(request())).status === 200 && initialized === 1);
    mode = "paid";
    assert((await handler!(request())).status === 409 && initialized === 1);
    mode = "normal";
    active.state = "initializing";
    assert((await handler!(request())).status === 409 && initialized === 1);
  } finally {
    Deno.serve = serve;
    globalThis.fetch = realFetch;
  }
});
