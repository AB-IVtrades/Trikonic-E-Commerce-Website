import { PDFDocument } from "npm:pdf-lib@1.17.1";
import {
  createReceiptPdf,
  receiptHtml,
  receiptTotals,
  safePhoto,
  savedReceiptPdf,
  toBase64,
} from "../_shared/receipt.ts";
const assert = (value: unknown, message = "Assertion failed") => {
  if (!value) throw new Error(message);
};
const sample = {
  id: "00000000-0000-0000-0000-000000000001",
  order_number: "TRK-1794816000000-TEST",
  customer_name: "Ama Osei",
  customer_email: "ama@example.test",
  contact: "020 000 0000",
  delivery_area: "East Legon, Accra",
  created_at: "2026-11-16T08:30:00Z",
  payment_paid_at: "2026-11-16T08:35:00Z",
  payment_reference: "TRK-test-reference",
  payment_status: "paid",
  currency: "GHS",
  estimated_total: 850,
  items: [{
    name: "Silver Crest 5L Digital Rice Cooker",
    image:
      "https://trikonicimports.com/images/silver-crest-digital-rice-cooker-burgundy-clean.png",
    variant: "5L",
    quantity: 1,
    unitPrice: 550,
    lineTotal: 550,
    shippingTotal: 50,
  }, {
    name: "3-in-1 Sandwich, Waffle & Grill Maker",
    quantity: 2,
    unitPrice: 100,
    lineTotal: 200,
    shippingTotal: 50,
  }],
};
const realFetch = globalThis.fetch;
Deno.test("receipt totals, escaping, Unicode, PDF pages and photo fallback", async () => {
  assert(
    receiptTotals(sample).subtotal === 75000 &&
      receiptTotals(sample).shipping === 10000,
  );
  assert(
    receiptTotals({
      ...sample,
      items: sample.items.map((i) => ({ ...i, shippingTotal: undefined })),
    }).breakdown === false,
  );
  assert(
    !safePhoto("https://localhost/secret") &&
      !safePhoto("https://trikonicimports.com.evil.test/images/x.jpg"),
  );
  const html = receiptHtml({
    ...sample,
    customer_name: "<script>Ama</script>",
  });
  assert(!html.includes("<script>") && html.includes("&lt;script&gt;"));
  const hairHtml = receiptHtml({
    ...sample,
    items: [{
      name: "Hair Closure",
      category: "Hair",
      size: "14 inches",
      variant: "4 x 4",
      quantity: 1,
      lineTotal: 350,
      shippingTotal: 50,
    }],
  });
  assert(
    hairHtml.includes("Hair Length: 14 inches") &&
      hairHtml.includes("Closure Size: 4 x 4"),
  );
  assert(
    html.includes("#0b3154") && html.includes("#ff710f") &&
      html.includes("GHS 850.00"),
  );
  globalThis.fetch = async () =>
    new Response(
      await Deno.readFile(
        "images/silver-crest-digital-rice-cooker-burgundy-clean.png",
      ),
      { headers: { "Content-Type": "image/png" } },
    );
  try {
    const pdf = await createReceiptPdf(sample);
    const doc = await PDFDocument.load(pdf);
    assert(doc.getPageCount() === 1);
    await Deno.mkdir("/private/tmp/trikonic-receipt-preview", {
      recursive: true,
    });
    await Deno.writeFile(
      "/private/tmp/trikonic-receipt-preview/receipt.pdf",
      pdf,
    );
    await Deno.writeTextFile(
      "/private/tmp/trikonic-receipt-preview/receipt.html",
      receiptHtml(sample),
    );
    const long = await createReceiptPdf({
      ...sample,
      customer_name: "Émilie Ŋɔdi",
      items: Array.from(
        { length: 18 },
        (_, n) => ({
          ...sample.items[1],
          name: `${n + 1}. Long product name with colour and size selected`,
          color: "Navy blue",
          size: "XL",
        }),
      ),
    });
    assert((await PDFDocument.load(long)).getPageCount() > 1);
    await Deno.writeFile(
      "/private/tmp/trikonic-receipt-preview/multiple-pages.pdf",
      long,
    );
    let rejected = false;
    try {
      await createReceiptPdf({ ...sample, payment_status: "pending" });
    } catch {
      rejected = true;
    }
    assert(rejected);
    globalThis.fetch = async () => {
      throw new Error("image unavailable");
    };
    assert((await createReceiptPdf(sample)).length > 1000);
  } finally {
    globalThis.fetch = realFetch;
  }
});
Deno.test("receipt storage returns the immutable winner during concurrent creation", async () => {
  let saved: Uint8Array | undefined, uploads = 0;
  globalThis.fetch = async (input: string | URL | Request, init?: any) => {
    if (String(input).includes("/storage/v1/")) {
      if (init?.method === "POST") {
        uploads++;
        saved = new Uint8Array([37, 80, 68, 70]);
        return new Response("{}", { status: 409 });
      }
      return saved
        ? new Response(new Uint8Array(saved))
        : new Response("{}", { status: 404 });
    }
    return new Response("", { status: 404 });
  };
  try {
    const bytes = await savedReceiptPdf(
      sample,
      "https://backend.test",
      "secret",
    );
    assert(bytes.length === 4 && uploads === 1);
    const second = await savedReceiptPdf(
      sample,
      "https://backend.test",
      "secret",
    );
    assert(toBase64(bytes) === toBase64(second) && uploads === 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
Deno.test("download authenticates users, checks ownership and blocks unpaid orders", async () => {
  let handler: (r: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
  }) as typeof Deno.serve;
  let mode = "paid";
  Deno.env.set("SUPABASE_URL", "https://backend.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "secret");
  globalThis.fetch = async (input: string | URL | Request, init?: any) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/rpc/consume_request_limit") {
      return Response.json(true);
    }
    if (url.pathname === "/auth/v1/user") {
      return mode === "bad-auth"
        ? new Response("{}", { status: 401 })
        : Response.json({ id: "customer-1" });
    }
    if (url.pathname === "/rest/v1/orders") {
      assert(url.searchParams.get("user_id") === "eq.customer-1");
      return Response.json(
        mode === "other-owner" ? [] : [{
          ...sample,
          payment_status: mode === "unpaid" ? "pending" : "paid",
        }],
      );
    }
    if (url.pathname.startsWith("/storage/")) {
      return new Response(new Uint8Array([37, 80, 68, 70]));
    }
    throw new Error(`Unexpected fetch ${input}`);
  };
  try {
    await import("../customer-receipt/index.ts");
    const request = (auth = true) =>
      new Request("https://backend.test", {
        method: "POST",
        headers: auth ? { Authorization: "Bearer user-token" } : {},
        body: JSON.stringify({ orderNumber: sample.order_number }),
      });
    assert((await handler!(request(false))).status === 401);
    mode = "bad-auth";
    assert((await handler!(request())).status === 401);
    mode = "other-owner";
    assert((await handler!(request())).status === 404);
    mode = "unpaid";
    assert((await handler!(request())).status === 409);
    mode = "paid";
    const response = await handler!(request());
    assert(
      response.status === 200 &&
        response.headers.get("content-type") === "application/pdf" &&
        response.headers.get("cache-control") === "no-store",
    );
  } finally {
    Deno.serve = serve;
    globalThis.fetch = realFetch;
  }
});
Deno.test("webhook verifies payment then sends branded email and the saved PDF once", async () => {
  let handler: (r: Request) => Promise<Response>;
  const serve = Deno.serve;
  Deno.serve = ((h: typeof handler) => {
    handler = h;
  }) as typeof Deno.serve;
  for (
    const [key, value] of Object.entries({
      SUPABASE_URL: "https://backend.test",
      SUPABASE_SERVICE_ROLE_KEY: "secret",
      PAYSTACK_SECRET_KEY: "paystack-test",
      APPS_SCRIPT_ORDER_ENDPOINT: "https://sheet.test",
      ORDER_STATUS_SYNC_TOKEN: "sync",
      RESEND_API_KEY: "resend-test",
    })
  ) Deno.env.set(key, value);
  let order: any = {
      ...sample,
      payment_status: "pending",
      email_notified_at: null,
      status: "Order Received",
      pricing_verified_at: "2026-11-16T00:00:00Z",
    },
    emails = 0,
    amount = 85000,
    attachment = "";
  globalThis.fetch = async (input: string | URL | Request, init?: any) => {
    const url = String(input);
    if (url.includes("/rest/v1/payment_attempts")) return Response.json([]);
    if (url.includes("/rest/v1/orders")) {
      if (init?.method === "PATCH") {
        Object.assign(order, JSON.parse(String(init.body)));
        return init.headers &&
            new Headers(init.headers).get("Prefer") === "return=representation"
          ? Response.json([order])
          : new Response(null, { status: 204 });
      }
      return Response.json([order]);
    }
    if (url.includes("api.paystack.co/")) {
      return Response.json({
        status: true,
        data: {
          status: "success",
          currency: "GHS",
          amount,
          reference: sample.payment_reference,
          paid_at: sample.payment_paid_at,
        },
      });
    }
    if (url === "https://sheet.test") return Response.json({ ok: true });
    if (url.includes("/storage/v1/")) {
      return new Response(new Uint8Array([37, 80, 68, 70]));
    }
    if (url === "https://api.resend.com/emails") {
      emails++;
      const payload = JSON.parse(String(init?.body));
      assert(order.payment_status === "paid");
      assert(
        payload.html.includes("Your order summary") &&
          payload.html.includes("#ff710f"),
      );
      attachment = payload.attachments[0].content;
      return Response.json({ id: "mock" });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  try {
    await import("../paystack-webhook/index.ts");
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: sample.payment_reference },
    });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("paystack-test"),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"],
    );
    const signature = [
      ...new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
      ),
    ].map((x) => x.toString(16).padStart(2, "0")).join("");
    const request = (sig = signature) =>
      new Request("https://backend.test", {
        method: "POST",
        headers: { "x-paystack-signature": sig },
        body,
      });
    assert((await handler!(request("invalid"))).status === 401 && emails === 0);
    amount = 1;
    assert(
      (await handler!(request())).status === 409 && emails === 0 &&
        order.payment_status === "pending",
    );
    amount = 85000;
    assert(
      (await handler!(request())).status === 200 && emails === 1 &&
        attachment === btoa("%PDF"),
    );
    assert((await handler!(request())).status === 200 && emails === 1);
  } finally {
    Deno.serve = serve;
    globalThis.fetch = realFetch;
  }
});
