import type { IncomingMessage, ServerResponse } from "node:http";
import type { OauthConfig } from "../oauth/config.js";
import {
  beginEntraAdminAuthorization,
  exchangeEntraAdminCode,
} from "../oauth/entra.js";
import type { StateProvider } from "../oauth/state.js";
import {
  currentRolesForPrincipal,
  type PostgresAccessGrantStore,
} from "../services/access-grants.js";
import type { BrainRole } from "../services/registry.js";
import { runtimeBrainId } from "../services/runtime-env.js";
import { AccessAdministrationService, AccessReconciliationError } from "./access-service.js";
import { accessAdminPage } from "./page.js";
import { AdminSessionStore, type AdminSession } from "./session.js";

const MAX_ADMIN_BODY = 32 * 1024;
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export interface AdminRouteContext {
  config: OauthConfig;
  state: StateProvider;
  sessions: AdminSessionStore;
  grants: PostgresAccessGrantStore;
  service: AccessAdministrationService;
  rolesForPrincipal?: typeof currentRolesForPrincipal;
}

function sendJson(res: ServerResponse, status: number, value: unknown, headers = {}): void {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(value));
}

function sendHtml(res: ServerResponse, status: number, value: string, headers = {}): void {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    ...headers,
  });
  res.end(value);
}

function safeError(error: unknown): string {
  if (error instanceof AccessReconciliationError) return error.message;
  const message = error instanceof Error ? error.message : "Request failed";
  if (/token|assertion|secret|authorization code/i.test(message)) {
    return "Identity provider request failed. Start a fresh owner session and retry.";
  }
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 320);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0];
  if (contentType !== "application/json") throw new Error("application/json is required");
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_ADMIN_BODY) {
        reject(new Error("Request body is too large"));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function assertMutationRequest(req: IncomingMessage, ctx: AdminRouteContext, session: AdminSession): void {
  const expectedOrigin = new URL(ctx.config.issuer).origin;
  if (req.headers.origin !== expectedOrigin) throw new Error("Same-origin request required");
  if (req.headers["x-brain-csrf"] !== session.csrfToken) throw new Error("Invalid CSRF token");
}

async function currentOwner(
  req: IncomingMessage,
  ctx: AdminRouteContext
): Promise<AdminSession | null> {
  const session = ctx.sessions.get(req.headers.cookie);
  if (!session) return null;
  const roles = await (ctx.rolesForPrincipal || currentRolesForPrincipal)(session.identity);
  if (roles[runtimeBrainId()] !== "owner") return null;
  try {
    const graphRoles = await ctx.service
      .graph(session.graphAccessToken)
      .rolesForUser(session.identity.providerUserId);
    return graphRoles.length === 1 && graphRoles[0] === "owner" ? session : null;
  } catch {
    // The owner administration plane fails closed when live group authority
    // cannot be revalidated. Content/tool authorization still uses the local
    // grant projection and is unaffected by a Graph outage.
    return null;
  }
}

function requireAdminDeployment(ctx: AdminRouteContext): void {
  if (
    runtimeBrainId() !== "ers-brain" ||
    !ctx.config.entra?.adminGraphEnabled ||
    !ctx.config.identityProviders.includes("entra")
  ) {
    throw new Error("not found");
  }
}

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: AdminRouteContext
): Promise<boolean> {
  if (!url.pathname.startsWith("/admin")) return false;
  try {
    requireAdminDeployment(ctx);
  } catch {
    sendJson(res, 404, { error: "not found" });
    return true;
  }

  try {
    if (req.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/access")) {
      sendHtml(res, 200, accessAdminPage());
      return true;
    }
    if (req.method === "GET" && url.pathname === "/admin/login") {
      res.writeHead(302, { ...SECURITY_HEADERS, Location: await beginEntraAdminAuthorization(ctx.config, ctx.state) });
      res.end();
      return true;
    }
    if (req.method === "GET" && url.pathname === new URL(ctx.config.entra!.adminCallbackUrl).pathname) {
      const result = await exchangeEntraAdminCode({
        searchParams: url.searchParams,
        config: ctx.config,
        state: ctx.state,
        rolesForPrincipal: ctx.rolesForPrincipal,
      });
      const created = ctx.sessions.create(result.identity, result.graphAccessToken, result.expiresIn);
      res.writeHead(302, { ...SECURITY_HEADERS, Location: "/admin/access", "Set-Cookie": created.cookie });
      res.end();
      return true;
    }

    const session = await currentOwner(req, ctx);
    if (!session) {
      sendJson(res, 401, { authenticated: false, error: "A fresh Entra Owner session is required" });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/admin/api/session") {
      sendJson(res, 200, {
        authenticated: true,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
        objectId: session.identity.providerUserId,
        name: session.identity.name,
        login: session.identity.login,
      });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/admin/api/users") {
      const users = await ctx.service.graph(session.graphAccessToken).searchUsers(url.searchParams.get("q") || "");
      sendJson(res, 200, { users });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/admin/api/access") {
      const [grants, audit] = await Promise.all([
        ctx.service.list(session.graphAccessToken),
        ctx.grants.listAuditEvents(runtimeBrainId(), 100),
      ]);
      sendJson(res, 200, { brainId: runtimeBrainId(), grants, audit });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/admin/api/access") {
      assertMutationRequest(req, ctx, session);
      const body = await readJson(req);
      if (body.brain_id || body.brainId || body.group_id || body.groupId) {
        throw new Error("Deployment and managed group identifiers are server-controlled");
      }
      const result = await ctx.service.mutate(
        session.identity,
        session.graphAccessToken,
        {
          target: {
            id: String(body.target?.id || ""),
            displayName: typeof body.target?.displayName === "string" ? body.target.displayName.slice(0, 200) : undefined,
            mail: typeof body.target?.mail === "string" ? body.target.mail.slice(0, 320) : undefined,
            userPrincipalName: typeof body.target?.userPrincipalName === "string" ? body.target.userPrincipalName.slice(0, 320) : undefined,
            userType: typeof body.target?.userType === "string" ? body.target.userType.slice(0, 80) : undefined,
          },
          role: body.role as BrainRole,
          status: body.status,
          reason: typeof body.reason === "string" ? body.reason : undefined,
          confirmed: body.confirmed === true,
        }
      );
      sendJson(res, 200, { ok: true, grant: result.grant, graphRequestIds: result.graph.requestIds });
      return true;
    }
    if (req.method === "POST" && url.pathname === "/admin/api/logout") {
      assertMutationRequest(req, ctx, session);
      await readJson(req);
      sendJson(res, 200, { ok: true }, { "Set-Cookie": ctx.sessions.destroy(req.headers.cookie) });
      return true;
    }
    sendJson(res, 404, { error: "not found" });
    return true;
  } catch (error) {
    const status = error instanceof AccessReconciliationError ? 409 : 400;
    sendJson(res, status, {
      error: safeError(error),
      ...(error instanceof AccessReconciliationError ? { reconciliationRequired: true, phase: error.phase } : {}),
    });
    return true;
  }
}
