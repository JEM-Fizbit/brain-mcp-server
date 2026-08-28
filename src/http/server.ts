import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createBrainMcpServer } from "../mcp-server.js";
import { SERVER_VERSION } from "../constants.js";
import { classifyPoolerUrl } from "../services/pooler.js";
import { buildOauthConfig, type OauthConfig } from "../oauth/config.js";
import { protectedResourceMetadata, authorizationServerMetadata } from "../oauth/metadata.js";
import { handleRegister } from "../oauth/register.js";
import { handleAuthorizeGet, handleGitHubCallback } from "../oauth/github.js";
import { handleEntraCallback } from "../oauth/entra.js";
import { handleToken } from "../oauth/token.js";
import { makeFileStateProvider, type StateProvider } from "../oauth/state.js";
import { makePostgresStateProvider } from "../oauth/postgres-state.js";
import { resolveAuth, wwwAuthenticateHeader } from "./mcp-auth.js";
import {
  assertHttpRuntimeConfig,
  oauthStateProvider,
  runtimeStatus,
} from "../services/runtime-config.js";
import { warmActiveBrainStore } from "../services/active-brain-store.js";
import {
  authReasonCode,
  recordAuthEventBestEffort,
} from "../services/auth-telemetry.js";
import { AdminSessionStore } from "../admin/session.js";
import { AccessAdministrationService } from "../admin/access-service.js";
import { handleAdminRequest, type AdminRouteContext } from "../admin/routes.js";
import { postgresAccessGrantStore } from "../services/access-grants.js";
import { runtimeBrainId } from "../services/runtime-env.js";
import { loadRegistry } from "../services/registry.js";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_OAUTH_BODY_BYTES = 16 * 1024;

type AuthenticatedRequest = IncomingMessage & { auth?: AuthInfo };

interface HttpContext {
  config: OauthConfig;
  state: StateProvider;
  admin?: AdminRouteContext;
}

function log(level: string, message: string, extra?: unknown): void {
  const line = extra
    ? `[${new Date().toISOString()}] ${level} ${message} ${JSON.stringify(extra)}`
    : `[${new Date().toISOString()}] ${level} ${message}`;
  (level === "ERROR" ? console.error : console.log)(line);
}

function logRequestTiming(
  level: "INFO" | "ERROR",
  message: string,
  req: IncomingMessage,
  res: ServerResponse,
  startedAt: number
): void {
  if (process.env.BRAIN_HTTP_TIMING_LOGS !== "1") return;
  log(level, message, {
    method: req.method,
    path: new URL(req.url || "/", "http://127.0.0.1").pathname,
    status: res.statusCode,
    duration_ms: Number((performance.now() - startedAt).toFixed(3)),
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...(headers || {}),
  });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string, headers?: Record<string, string>): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...(headers || {}),
  });
  res.end(body);
}

function sendHtml(res: ServerResponse, status: number, body: string, headers?: Record<string, string>): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    ...(headers || {}),
  });
  res.end(body);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`body exceeded ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function methodNotAllowed(res: ServerResponse, allow = "POST"): void {
  sendText(res, 405, "method not allowed", { Allow: allow });
}

function makeHttpStateProvider(): StateProvider {
  if (oauthStateProvider() !== "postgres") return makeFileStateProvider();
  const databaseUrl = process.env.BRAIN_REVISION_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("BRAIN_REVISION_DATABASE_URL is required when BRAIN_OAUTH_STATE_STORE=postgres");
  }
  return makePostgresStateProvider(databaseUrl);
}

async function handleMcp(
  req: AuthenticatedRequest,
  res: ServerResponse,
  ctx: HttpContext
): Promise<void> {
  const startedAt = performance.now();
  if (req.method !== "POST") {
    methodNotAllowed(res, "POST");
    logRequestTiming("INFO", "mcp request completed", req, res, startedAt);
    return;
  }

  const auth = resolveAuth(req.headers.authorization, ctx.config);
  if (!auth.ok) {
    const reason = authReasonCode(auth.reason);
    sendJson(
      res,
      401,
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: `unauthorized: ${auth.reason}` },
      },
      { "WWW-Authenticate": wwwAuthenticateHeader(ctx.config, auth.reason) }
    );
    const maybeWrite = recordAuthEventBestEffort({
      name: "mcp_authorization",
      reason,
      httpStatus: 401,
      durationMs: performance.now() - startedAt,
    });
    if (maybeWrite) await maybeWrite;
    logRequestTiming("INFO", "mcp request completed", req, res, startedAt);
    return;
  }
  req.auth = auth.authInfo;

  let rawBody: string;
  try {
    rawBody = await readRawBody(req, MAX_BODY_BYTES);
  } catch {
    sendText(res, 413, "body too large");
    logRequestTiming("INFO", "mcp request completed", req, res, startedAt);
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (error: any) {
    sendJson(res, 400, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: `parse error: ${error.message}` },
    });
    logRequestTiming("INFO", "mcp request completed", req, res, startedAt);
    return;
  }

  const server = createBrainMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    logRequestTiming("INFO", "mcp request completed", req, res, startedAt);
  }
}

export async function handleHttpRequest(
  req: AuthenticatedRequest,
  res: ServerResponse,
  ctx: HttpContext
): Promise<void> {
  const url = new URL(req.url || "/", ctx.config.issuer);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith("/admin")) {
      if (!ctx.admin) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      await handleAdminRequest(req, res, url, ctx.admin);
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      const certificateExpiresAt = ctx.config.entra?.clientCertificateExpiresAt;
      const certificateDaysRemaining = certificateExpiresAt
        ? Math.floor((Date.parse(certificateExpiresAt) - Date.now()) / 86_400_000)
        : undefined;
      sendJson(res, 200, {
        ok: true,
        transport: "http",
        mcp: {
          path: "/mcp",
          server: { name: "brain-mcp-server", version: SERVER_VERSION },
        },
        oauth: {
          issuer: ctx.config.issuer,
          resource_uri: ctx.config.resourceUri,
          authorization_endpoint: ctx.config.authorizationEndpoint,
          token_endpoint: ctx.config.tokenEndpoint,
          registration_endpoint: ctx.config.registrationEndpoint,
          identity_providers: ctx.config.identityProviders || ["github"],
          default_identity_provider:
            ctx.config.identityDefaultProvider || "github",
          entra_certificate:
            ctx.config.entra && certificateExpiresAt
              ? {
                  expires_at: certificateExpiresAt,
                  days_remaining: certificateDaysRemaining,
                  status:
                    Number(certificateDaysRemaining) < 0
                      ? "expired"
                      : Number(certificateDaysRemaining) <= 30
                        ? "warn"
                        : "ok",
                }
              : undefined,
          access_admin_enabled: Boolean(ctx.admin),
        },
        runtime: runtimeStatus(),
      });
      return;
    }

    if (
      req.method === "GET" &&
      pathname.startsWith("/.well-known/oauth-protected-resource")
    ) {
      sendJson(res, 200, protectedResourceMetadata(ctx.config), {
        "Cache-Control": "public, max-age=3600",
      });
      return;
    }

    if (req.method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
      sendJson(res, 200, authorizationServerMetadata(ctx.config), {
        "Cache-Control": "public, max-age=3600",
      });
      return;
    }

    if (req.method === "POST" && pathname === "/register") {
      const rawBody = await readRawBody(req, MAX_OAUTH_BODY_BYTES);
      const result = await handleRegister(rawBody, ctx.config, ctx.state);
      sendJson(res, result.status, result.body);
      return;
    }

    if (req.method === "GET" && pathname === "/authorize") {
      const result = await handleAuthorizeGet(url.searchParams, ctx.config, ctx.state);
      if (result.status === 302 && result.headers.Location) {
        redirect(res, result.headers.Location);
      } else {
        sendHtml(res, result.status, result.body, result.headers);
      }
      return;
    }

    if (
      req.method === "GET" &&
      ctx.config.githubCallbackUrl &&
      pathname === new URL(ctx.config.githubCallbackUrl).pathname
    ) {
      const result = await handleGitHubCallback(url.searchParams, ctx.config, ctx.state);
      if (result.status === 302 && result.headers.Location) {
        redirect(res, result.headers.Location);
      } else {
        sendHtml(res, result.status, result.body, result.headers);
      }
      return;
    }

    if (
      req.method === "GET" &&
      ctx.config.entra &&
      pathname === new URL(ctx.config.entra.callbackUrl).pathname
    ) {
      const result = await handleEntraCallback(url.searchParams, ctx.config, ctx.state);
      if (result.status === 302 && result.headers.Location) {
        redirect(res, result.headers.Location);
      } else {
        sendHtml(res, result.status, result.body, result.headers);
      }
      return;
    }

    if (req.method === "POST" && pathname === "/token") {
      const startedAt = performance.now();
      const rawBody = await readRawBody(req, MAX_OAUTH_BODY_BYTES);
      const result = await handleToken(
        new URLSearchParams(rawBody),
        req.headers.authorization,
        ctx.config,
        ctx.state
      );
      sendJson(res, result.status, result.body);
      if (result.status >= 400) {
        const reason = authReasonCode(
          result.body?.error_description || result.body?.error || "oauth_token_error"
        );
        const target = authReasonCode(result.body?.error || "oauth_token_error");
        const maybeWrite = recordAuthEventBestEffort({
          name: "oauth_token",
          reason,
          target,
          httpStatus: result.status,
          durationMs: performance.now() - startedAt,
          clientId: result.clientId,
          grantType: result.grantType,
        });
        if (maybeWrite) await maybeWrite;
      }
      return;
    }

    if (pathname === "/mcp") {
      await handleMcp(req, res, ctx);
      return;
    }

    if (req.method === "GET" && pathname === "/") {
      sendText(res, 200, "brain-mcp-server. See GET /health.\n");
      return;
    }

    sendText(res, 404, "not found");
  } catch (error: any) {
    log("ERROR", "http request failed", { path: pathname, error: error.message });
    if (!res.headersSent) sendText(res, 500, "internal error");
  }
}

export async function startHttpServer(): Promise<void> {
  assertHttpRuntimeConfig();
  if (process.env.BRAIN_REVISION_STORE === "postgres") {
    const pooler = classifyPoolerUrl(process.env.BRAIN_REVISION_DATABASE_URL);
    if (pooler.mode === "session") {
      log(
        "WARN",
        "BRAIN_REVISION_DATABASE_URL uses the Supabase session pooler (hard ~15-client cap shared across all clients); risks EMAXCONNSESSION under concurrent load — switch to the transaction pooler (:6543). See docs/deploy-fly.md.",
        { pooler: pooler.label, host: pooler.host, port: pooler.port }
      );
    }
  }
  if (process.env.BRAIN_HTTP_WARMUP !== "0") {
    const startedAt = performance.now();
    await warmActiveBrainStore();
    log("INFO", "hosted Brain store warmed", {
      duration_ms: Number((performance.now() - startedAt).toFixed(3)),
    });
  }

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || process.env.MCP_HTTP_HOST || "127.0.0.1";
  const config = buildOauthConfig();
  const state = makeHttpStateProvider();
  const ctx: HttpContext = { config, state };
  if (
    runtimeBrainId() === "ers-brain" &&
    config.entra?.adminGraphEnabled
  ) {
    const grants = postgresAccessGrantStore();
    const requiredOwners = Number(process.env.ENTRA_REQUIRED_INITIAL_OWNER_COUNT || 3);
    if (!Number.isInteger(requiredOwners) || requiredOwners < 2 || requiredOwners > 10) {
      throw new Error("ENTRA_REQUIRED_INITIAL_OWNER_COUNT must be an integer between 2 and 10");
    }
    const activeOwners = await grants.countActiveOwners(
      "ers-brain",
      "entra",
      config.entra.tenantId
    );
    if (activeOwners < requiredOwners) {
      throw new Error(
        `ERS access administration requires ${requiredOwners} active Owners; found ${activeOwners}`
      );
    }
    ctx.admin = {
      config,
      state,
      sessions: new AdminSessionStore(config),
      grants,
      service: new AccessAdministrationService(
        "ers-brain",
        config.entra,
        grants,
        (await loadRegistry()).principals || []
      ),
    };
  }

  const server = http.createServer((req, res) => {
    handleHttpRequest(req as AuthenticatedRequest, res, ctx).catch((error) => {
      log("ERROR", "unhandled http error", { error: error.message });
      if (!res.headersSent) sendText(res, 500, "internal error");
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });
  log("INFO", `brain-mcp-server listening on http://${host}:${port}`);
}
