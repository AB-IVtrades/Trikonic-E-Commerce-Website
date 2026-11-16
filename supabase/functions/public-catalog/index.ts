import { loadCatalog } from "../_shared/catalog.ts";
import { failure } from "../_shared/server.ts";
let cached: { body: string; until: number } | undefined;
let pending: Promise<string> | undefined;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "public, max-age=60, s-maxage=60",
};
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...headers, "Cache-Control": "no-store", Allow: "GET, OPTIONS" },
    });
  }
  try {
    if (!cached || cached.until <= Date.now()) {
      // Coalesce concurrent reads. No client-supplied URL is ever fetched.
      pending ||= loadCatalog().then(products => {
        const body = JSON.stringify({ ready: true, products });
        cached = { body, until: Date.now() + 60000 };
        return body;
      }).finally(() => { pending = undefined; });
      await pending;
    }
    return new Response(cached!.body, { headers });
  } catch (error) { return failure(error); }
});
