import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { OauthConfig } from "../oauth/config.js";
import type { EntraIdentity } from "../oauth/entra.js";

const COOKIE_NAME = "brain_ers_admin";

export interface AdminSession {
  id: string;
  identity: EntraIdentity;
  graphAccessToken: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries(
    (header || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index < 0
          ? [part, ""]
          : [part.slice(0, index), safeDecode(part.slice(index + 1))];
      })
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export class AdminSessionStore {
  private readonly sessions = new Map<string, AdminSession>();

  constructor(private readonly config: OauthConfig) {
    if (!config.adminSessionSecret || config.adminSessionSecret.length < 32) {
      throw new Error("ENTRA_ADMIN_SESSION_SECRET must be at least 32 characters");
    }
  }

  private signature(id: string): string {
    return createHmac("sha256", this.config.adminSessionSecret!)
      .update(id)
      .digest("base64url");
  }

  private signedId(id: string): string {
    return `${id}.${this.signature(id)}`;
  }

  private verifiedId(value: string | undefined): string | null {
    if (!value) return null;
    const index = value.lastIndexOf(".");
    if (index < 1) return null;
    const id = value.slice(0, index);
    const presented = Buffer.from(value.slice(index + 1));
    const expected = Buffer.from(this.signature(id));
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      return null;
    }
    return id;
  }

  create(
    identity: EntraIdentity,
    graphAccessToken: string,
    upstreamExpiresIn: number
  ): { session: AdminSession; cookie: string } {
    this.sweep();
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.max(
      60,
      Math.min(this.config.adminSessionTtlSec, Math.floor(upstreamExpiresIn))
    );
    const session: AdminSession = {
      id: randomToken(),
      identity,
      graphAccessToken,
      csrfToken: randomToken(),
      createdAt: now,
      expiresAt: now + ttl,
    };
    for (const [id, existing] of this.sessions) {
      if (
        existing.identity.providerTenantId === identity.providerTenantId &&
        existing.identity.providerUserId === identity.providerUserId
      ) {
        this.sessions.delete(id);
      }
    }
    while (this.sessions.size >= 100) {
      this.sessions.delete(this.sessions.keys().next().value!);
    }
    this.sessions.set(session.id, session);
    const secure = new URL(this.config.issuer).protocol === "https:" ? "; Secure" : "";
    return {
      session,
      cookie: `${COOKIE_NAME}=${encodeURIComponent(this.signedId(session.id))}; Path=/admin; Max-Age=${ttl}; HttpOnly; SameSite=Lax${secure}`,
    };
  }

  get(cookieHeader: string | undefined): AdminSession | null {
    this.sweep();
    const id = this.verifiedId(parseCookies(cookieHeader)[COOKIE_NAME]);
    if (!id) return null;
    return this.sessions.get(id) || null;
  }

  destroy(cookieHeader: string | undefined): string {
    const id = this.verifiedId(parseCookies(cookieHeader)[COOKIE_NAME]);
    if (id) this.sessions.delete(id);
    const secure = new URL(this.config.issuer).protocol === "https:" ? "; Secure" : "";
    return `${COOKIE_NAME}=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  }

  private sweep(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id);
    }
  }
}
