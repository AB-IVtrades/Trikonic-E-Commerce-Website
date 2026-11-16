import { readJson, RequestError } from "../_shared/server.ts";
import { rateLimit } from "../_shared/limits.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  receiptColumns,
  receiptFilename,
  savedReceiptPdf,
} from "../_shared/receipt.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") return json("Method not allowed", 405);
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return json("Please sign in to download your receipt.", 401);
  }
  const url = Deno.env.get("SUPABASE_URL")!,
    key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const auth = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: authorization },
    });
    if (!auth.ok) return json("Please sign in again.", 401);
    const user = await auth.json();
    if (!user.id) return json("Could not verify your account.", 401);
    await rateLimit("receipt", user.id, 20, 60);
    const { orderNumber } = await readJson(request, 4096);
    if (
      typeof orderNumber !== "string" ||
      !/^TRK-[0-9]{13}-[A-Z0-9]{4}$/.test(orderNumber)
    ) return json("Invalid order number.", 400);
    const lookup = new URL(`${url}/rest/v1/orders`);
    lookup.searchParams.set("order_number", `eq.${orderNumber}`);
    lookup.searchParams.set("user_id", `eq.${user.id}`);
    lookup.searchParams.set("select", receiptColumns);
    const found = await fetch(lookup, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!found.ok) throw new Error("Could not load order");
    const [order] = await found.json();
    if (!order) return json("Order not found.", 404);
    if (order.payment_status !== "paid") {
      return json(
        "Your receipt will be available after payment is confirmed.",
        409,
      );
    }
    const pdf = await savedReceiptPdf(order, url, key);
    return new Response(new Uint8Array(pdf), {
      headers: {
        ...cors,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${
          receiptFilename(order)
        }"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Receipt download failed", error);
    return json(
      error instanceof RequestError
        ? error.message
        : "Could not prepare your receipt. Please try again.",
      error instanceof RequestError ? error.status : 503,
    );
  }
});
