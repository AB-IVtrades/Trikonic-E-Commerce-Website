import { environment, RequestError } from "./server.ts";
export async function rateLimit(
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
) {
  const env = environment();
  // Keyed hash prevents recovering a contact email or IP from the counters.
  const secret = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    secret,
    new TextEncoder().encode(`${scope}:${subject}`),
  );
  const key = Array.from(
    new Uint8Array(digest),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  const response = await fetch(`${env.url}/rest/v1/rpc/consume_request_limit`, {
    method: "POST",
    headers: env.headers,
    body: JSON.stringify({
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new RequestError(
      "Could not check request limit. Please try again shortly.",
      503,
    );
  }
  if (await response.json() !== true) {
    throw new RequestError(
      "Too many attempts. Please wait a little before trying again.",
      429,
    );
  }
}
