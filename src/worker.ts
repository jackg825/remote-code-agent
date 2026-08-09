import { createRemoteJWKSet, jwtVerify } from "jose";

const DYNAMIC_PATHS = new Set(["/healthz", "/ws"]);

type ProxyConfiguration =
  | { mode: "local"; origin: URL }
  | { mode: "production"; origin: URL; teamDomain: URL };

function isDynamicPath(pathname: string): boolean {
  return DYNAMIC_PATHS.has(pathname) || pathname.startsWith("/api/");
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function requiredUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
}

function configurationFor(request: Request, env: Env): ProxyConfiguration {
  const requestUrl = new URL(request.url);

  if (isLoopback(requestUrl.hostname)) {
    const origin = requiredUrl(env.LOCAL_ORIGIN_URL, "LOCAL_ORIGIN_URL");
    if (!isLoopback(origin.hostname) || !["http:", "https:"].includes(origin.protocol)) {
      throw new Error("LOCAL_ORIGIN_URL must use a loopback hostname");
    }
    return { mode: "local", origin };
  }

  const origin = requiredUrl(env.ORIGIN_URL, "ORIGIN_URL");
  if (
    origin.protocol !== "https:" ||
    origin.hostname.endsWith(".example.com") ||
    origin.hostname === requestUrl.hostname
  ) {
    throw new Error("ORIGIN_URL must be the HTTPS Tunnel origin");
  }

  const teamDomain = requiredUrl(env.ACCESS_TEAM_DOMAIN, "ACCESS_TEAM_DOMAIN");
  if (
    teamDomain.protocol !== "https:" ||
    !teamDomain.hostname.endsWith(".cloudflareaccess.com")
  ) {
    throw new Error("ACCESS_TEAM_DOMAIN must be a Cloudflare Access team domain");
  }

  if (!env.ACCESS_AUD || env.ACCESS_AUD.startsWith("replace-with-")) {
    throw new Error("ACCESS_AUD must be the public Access application AUD");
  }
  if (!env.ACCESS_CLIENT_ID || !env.ACCESS_CLIENT_SECRET) {
    throw new Error("Cloudflare Access service token secrets are missing");
  }

  return { mode: "production", origin, teamDomain };
}

function jsonError(status: number, error: string): Response {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

async function hasValidAccessIdentity(
  request: Request,
  teamDomain: URL,
  audience: string,
): Promise<boolean> {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) {
    return false;
  }

  try {
    const keySet = createRemoteJWKSet(
      new URL("/cdn-cgi/access/certs", teamDomain),
    );
    await jwtVerify(assertion, keySet, {
      audience,
      issuer: teamDomain.origin,
    });
    return true;
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "access_jwt_rejected",
        reason: error instanceof Error ? error.name : "unknown",
      }),
    );
    return false;
  }
}

async function proxyToInstance(
  request: Request,
  env: Env,
  configuration: ProxyConfiguration,
): Promise<Response> {
  if (configuration.mode === "production") {
    const authorized = await hasValidAccessIdentity(
      request,
      configuration.teamDomain,
      env.ACCESS_AUD,
    );
    if (!authorized) {
      return jsonError(401, "Cloudflare Access authentication required");
    }
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(configuration.origin);
  upstreamUrl.pathname = incomingUrl.pathname;
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Cf-Access-Jwt-Assertion");

  if (configuration.mode === "production") {
    headers.set("CF-Access-Client-Id", env.ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", env.ACCESS_CLIENT_SECRET);
  }

  try {
    return await fetch(
      new Request(upstreamUrl, {
        body: request.body,
        headers,
        method: request.method,
        redirect: "manual",
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "origin_proxy_failed",
        path: incomingUrl.pathname,
        reason: error instanceof Error ? error.name : "unknown",
      }),
    );
    return jsonError(502, "Terminal origin unavailable");
  }
}

async function serveAsset(request: Request, env: Env): Promise<Response> {
  return await env.ASSETS.fetch(request);
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (!isDynamicPath(url.pathname)) {
    return await serveAsset(request, env);
  }

  if (
    url.pathname === "/ws" &&
    request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
  ) {
    return jsonError(426, "WebSocket upgrade required");
  }

  let configuration: ProxyConfiguration;
  try {
    configuration = configurationFor(request, env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "invalid_worker_configuration",
        reason: error instanceof Error ? error.message : "unknown",
      }),
    );
    return jsonError(503, "Worker is not configured");
  }

  return await proxyToInstance(request, env, configuration);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "request_failed",
          method: request.method,
          path: new URL(request.url).pathname,
          reason: error instanceof Error ? error.name : "unknown",
        }),
      );
      return jsonError(500, "Internal error");
    }
  },
} satisfies ExportedHandler<Env>;
