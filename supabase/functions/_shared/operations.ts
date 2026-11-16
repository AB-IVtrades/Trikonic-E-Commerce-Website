import { customer, environment, RequestError } from "./server.ts";
export async function rpc(name: string, body: Record<string, unknown> = {}) {
  const env = environment();
  const response = await fetch(`${env.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: env.headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("Operation failed", name, response.status, data?.code);
    throw new RequestError(
      response.status >= 500
        ? "Order service is temporarily unavailable."
        : data?.code === "P0001"
        ? data.message
        : "Invalid order operation.",
      response.status >= 500
        ? 503
        : data?.message === "Order not found"
        ? 404
        : 409,
    );
  }
  return data;
}
export async function administrator(request: Request, requireMfa = true) {
  const context = await customer(request);
  if (context.user.app_metadata?.store_role !== "admin") {
    throw new RequestError("Store administrator access is required.", 403);
  }
  // getUser above verifies the exact bearer JWT with Auth before reading its assurance claim.
  let claims: any;
  try {
    const token = request.headers.get("authorization")!.split(/\s+/)[1];
    claims = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
  } catch {
    throw new RequestError("Please sign in again.", 401);
  }
  if (claims.sub !== context.user.id) {
    throw new RequestError("Please sign in again.", 401);
  }
  if (requireMfa && claims.aal !== "aal2") {
    throw new RequestError(
      "Complete authenticator verification to open the dashboard.",
      403,
    );
  }
  return { ...context, aal: claims.aal };
}
