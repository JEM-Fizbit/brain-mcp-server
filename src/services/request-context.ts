import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  loadRegistry,
  principalFromAuthInfo,
  validateBrainId,
  type BrainDefinition,
  type BrainPrincipal,
  type BrainRole,
} from "./registry.js";
import type { RevisionActor } from "../sync/types.js";
import { currentRolesForPrincipal } from "./access-grants.js";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification> | undefined;

export interface ToolBrainContext {
  brainId: string;
  brain: BrainDefinition;
  role: BrainRole;
  principal: BrainPrincipal;
}

export async function resolveToolBrain(
  brainId?: string,
  extra?: ToolExtra
): Promise<ToolBrainContext> {
  const principal = principalFromAuthInfo(extra?.authInfo);
  const registry = await loadRegistry();
  const roles = await currentRolesForPrincipal(principal);
  const accessible = registry.brains
    .filter((brain) => roles[brain.id])
    .map((brain) => ({ brain, role: roles[brain.id] }));
  if (brainId) {
    validateBrainId(brainId);
    const match = accessible.find(({ brain }) => brain.id === brainId);
    if (!match) {
      const known = accessible.map(({ brain }) => brain.id).join(", ") || "(none)";
      throw new Error(`Brain not accessible: ${brainId}. Accessible Brains: ${known}`);
    }
    return {
      brainId: match.brain.id,
      brain: match.brain,
      role: match.role,
      principal,
    };
  }
  if (accessible.length !== 1) {
    const known = accessible.map(({ brain }) => brain.id).join(", ") || "(none)";
    throw new Error(`brain_id is required. Accessible Brains: ${known}`);
  }
  const [match] = accessible;
  return {
    brainId: match.brain.id,
    brain: match.brain,
    role: match.role,
    principal,
  };
}

export function assertWriteRole(ctx: ToolBrainContext): void {
  if (ctx.role === "owner" || ctx.role === "admin" || ctx.role === "member") return;
  if (ctx.role === "reader") {
    throw new Error(`Write access denied for Brain: ${ctx.brainId}`);
  }
  throw new Error(
    `Write access denied for Brain ${ctx.brainId}: unknown role ${String(ctx.role)}`
  );
}

export function authorIdentity(ctx: ToolBrainContext): string | undefined {
  if (ctx.principal.provider === "stdio") return undefined;

  const name =
    ctx.principal.name ||
    ctx.principal.login ||
    `${ctx.principal.provider}:${ctx.principal.providerUserId}`;
  if (ctx.principal.email) return `${name} <${ctx.principal.email}>`;
  if (ctx.principal.provider === "github" && ctx.principal.login) {
    return `${name} <${ctx.principal.login}@users.noreply.github.com>`;
  }
  return name;
}

export function revisionActor(ctx: ToolBrainContext): RevisionActor | undefined {
  if (ctx.principal.provider === "stdio") return undefined;
  return {
    provider: ctx.principal.provider,
    id: ctx.principal.providerUserId,
    name: ctx.principal.name || ctx.principal.login,
    email: ctx.principal.email,
  };
}

export async function listBrainsForExtra(extra?: ToolExtra): Promise<
  {
    id: string;
    type: string;
    template_used: string;
    integration_mode: string;
    role: BrainRole;
    metadata: Record<string, unknown>;
  }[]
> {
  const registry = await loadRegistry();
  const principal = principalFromAuthInfo(extra?.authInfo);
  const roles = await currentRolesForPrincipal(principal);
  return registry.brains
    .filter((brain) => roles[brain.id])
    .map((brain) => ({
      id: brain.id,
      type: brain.type,
      template_used: brain.template_used,
      integration_mode: brain.integration_mode,
      role: roles[brain.id],
      metadata: brain.metadata || {},
    }));
}

export async function describeBrainForExtra(
  brainId: string,
  extra?: ToolExtra
): Promise<BrainDefinition & { role: BrainRole }> {
  const ctx = await resolveToolBrain(brainId, extra);
  return { ...ctx.brain, role: ctx.role };
}

export async function rolesForExtra(extra?: ToolExtra): Promise<Record<string, BrainRole>> {
  const principal = principalFromAuthInfo(extra?.authInfo);
  return currentRolesForPrincipal(principal);
}
