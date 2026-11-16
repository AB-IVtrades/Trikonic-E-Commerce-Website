export class RequestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export function environment() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) {
    throw new RequestError("Service temporarily unavailable.", 503);
  }
  return {
    url,
    key,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}
export async function customer(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    throw new RequestError("Please sign in to continue.", 401);
  }
  const env = environment();
  const response = await fetch(`${env.url}/auth/v1/user`, {
    headers: { apikey: env.key, Authorization: authorization },
  });
  if (!response.ok) {
    throw new RequestError(
      "Your session has expired. Please sign in again.",
      401,
    );
  }
  const user = await response.json();
  if (!user.id || !user.email || !user.email_confirmed_at) {
    throw new RequestError("Please confirm your email and sign in.", 401);
  }
  return { env, user };
}
export function failure(error: unknown) {
  if (error instanceof RequestError) {
    return json({ error: error.message }, error.status);
  }
  console.error(
    "Request failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  return json(
    { error: "Service temporarily unavailable. Please try again." },
    503,
  );
}
export async function rows(path: string, params: Record<string, string> = {}) {
  const env = environment(), url = new URL(`${env.url}/rest/v1/${path}`);
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value)
  );
  const response = await fetch(url, { headers: env.headers });
  if (!response.ok) {
    throw new RequestError("Could not load your order. Please retry.", 503);
  }
  return await response.json();
}
