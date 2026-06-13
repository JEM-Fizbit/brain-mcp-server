import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  accessibleRoles,
  listAccessibleBrains,
  loadRegistry,
  principalFromAuthInfo,
  resolveBrain,
  type BrainDefinition,
  type BrainPrincipal,
  type BrainRole,
} from "./registry.js";

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
  const { brain, role } = await resolveBrain(brainId, principal);
  return { brainId: brain.id, brain, role, principal };
}

export function assertWriteRole(ctx: ToolBrainContext): void {
  if (ctx.role === "reader") {
    throw new Error(`Write access denied for Brain: ${ctx.brainId}`);
  }
}

export function authorIdentity(ctx: ToolBrainContext): string | undefined {
  if (ctx.principal.provider === "stdio") return undefined;

  const name =
    ctx.principal.name ||
    ctx.principal.login ||
    `${ctx.principal.provider}:${ctx.principal.providerUserId}`;
  const email =
    ctx.principal.email ||
    (ctx.principal.login
      ? `${ctx.principal.login}@users.noreply.github.com`
      : `${ctx.principal.providerUserId}+${ctx.principal.provider}@users.noreply.github.com`);

  return `${name} <${email}>`;
}

export async function listBrainsForExtra(extra?: ToolExtra): Promise<
  { id: string; type: string; template_used: string; integration_mode: string; role: BrainRole }[]
> {
  const registry = await loadRegistry();
  const principal = principalFromAuthInfo(extra?.authInfo);
  return listAccessibleBrains(registry, principal).map(({ brain, role }) => ({
    id: brain.id,
    type: brain.type,
    template_used: brain.template_used,
    integration_mode: brain.integration_mode,
    role,
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
  const registry = await loadRegistry();
  const principal = principalFromAuthInfo(extra?.authInfo);
  return accessibleRoles(registry, principal);
}
