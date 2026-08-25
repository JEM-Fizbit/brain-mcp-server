import pg from "pg";
import { postgresPoolOptions } from "../sync/postgres-revision-store.js";
import { attachPoolErrorLogger } from "./pg-pool.js";
import {
  accessibleRoles,
  loadRegistry,
  type BrainPrincipal,
  type BrainRole,
} from "./registry.js";
import { runtimeBrainId } from "./runtime-env.js";

const { Pool } = pg;
type Pool = pg.Pool;

export type GrantStatus = "active" | "suspended" | "revoked";

export interface AccessGrant {
  brainId: string;
  provider: string;
  providerTenantId?: string;
  providerUserId: string;
  name?: string;
  email?: string;
  role: BrainRole;
  status: GrantStatus;
  roleSource?: string;
  upstreamRole?: string;
  upstreamGroupId?: string;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AccessGrantMutation {
  brainId: string;
  target: BrainPrincipal;
  role: BrainRole;
  status: GrantStatus;
  roleSource: string;
  upstreamRole?: string;
  upstreamGroupId?: string;
  actor: BrainPrincipal;
  reason?: string;
  graphOutcome?: string;
  graphRequestId?: string;
}

export interface AccessAuditEvent {
  id: string;
  brainId: string;
  actorProvider: string;
  actorTenantId?: string;
  actorUserId: string;
  targetProvider: string;
  targetTenantId?: string;
  targetUserId: string;
  targetName?: string;
  action: "grant" | "change" | "suspend" | "reinstate" | "revoke" | "reconcile";
  oldRole?: BrainRole;
  newRole?: BrainRole;
  oldStatus?: GrantStatus;
  newStatus?: GrantStatus;
  reason?: string;
  graphOutcome?: string;
  graphRequestId?: string;
  createdAt: string;
}

function usePostgresGrants(principal?: BrainPrincipal): boolean {
  return (
    process.env.BRAIN_ACCESS_GRANT_STORE === "postgres" ||
    principal?.provider === "entra"
  );
}

function requireDatabaseUrl(): string {
  const value = process.env.BRAIN_REVISION_DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "BRAIN_REVISION_DATABASE_URL is required for Postgres access grants"
    );
  }
  return value;
}

let sharedStore: PostgresAccessGrantStore | undefined;

export function resetAccessGrantStoreForTests(): void {
  sharedStore = undefined;
}

export function postgresAccessGrantStore(): PostgresAccessGrantStore {
  if (!sharedStore) sharedStore = new PostgresAccessGrantStore(requireDatabaseUrl());
  return sharedStore;
}

function normalizedTenant(principal: BrainPrincipal): string {
  return principal.providerTenantId?.trim().toLowerCase() || "";
}

export class PostgresAccessGrantStore {
  readonly pool: Pool;

  constructor(poolOrConnectionString: Pool | string) {
    this.pool =
      typeof poolOrConnectionString === "string"
        ? attachPoolErrorLogger(
            new Pool(
              postgresPoolOptions(poolOrConnectionString, {
                allowExitOnIdle: true,
                maxEnv: "BRAIN_ACCESS_GRANT_PG_POOL_MAX",
                defaultMax: 2,
              })
            ),
            "access_grants"
          )
        : poolOrConnectionString;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async rolesForPrincipal(principal: BrainPrincipal): Promise<Record<string, BrainRole>> {
    if (!principal.providerUserId) return {};
    const result = await this.pool.query(
      `
        select r.brain_id, r.role
        from brain.principals p
        join brain.brain_roles r on r.principal_id = p.id
        where p.provider = $1
          and p.provider_tenant_id = $2
          and p.provider_user_id = $3
          and r.status = 'active'
        order by r.brain_id
      `,
      [principal.provider, normalizedTenant(principal), principal.providerUserId]
    );
    return Object.fromEntries(
      result.rows.map((row: { brain_id: string; role: BrainRole }) => [
        row.brain_id,
        row.role,
      ])
    );
  }

  async getGrant(
    brainId: string,
    principal: BrainPrincipal
  ): Promise<AccessGrant | null> {
    const result = await this.pool.query(
      `
        select
          r.brain_id,
          p.provider,
          p.provider_tenant_id,
          p.provider_user_id,
          p.name,
          p.email,
          r.role,
          r.status,
          r.role_source,
          r.upstream_role,
          r.upstream_group_id,
          r.version,
          r.created_at,
          r.updated_at
        from brain.principals p
        join brain.brain_roles r on r.principal_id = p.id
        where r.brain_id = $1
          and p.provider = $2
          and p.provider_tenant_id = $3
          and p.provider_user_id = $4
      `,
      [
        brainId,
        principal.provider,
        normalizedTenant(principal),
        principal.providerUserId,
      ]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      brainId: row.brain_id,
      provider: row.provider,
      providerTenantId: row.provider_tenant_id || undefined,
      providerUserId: row.provider_user_id,
      name: row.name || undefined,
      email: row.email || undefined,
      role: row.role,
      status: row.status,
      roleSource: row.role_source || undefined,
      upstreamRole: row.upstream_role || undefined,
      upstreamGroupId: row.upstream_group_id || undefined,
      version: Number(row.version || 1),
      createdAt: row.created_at?.toISOString?.() || String(row.created_at || ""),
      updatedAt: row.updated_at?.toISOString?.() || String(row.updated_at || ""),
    };
  }

  async listGrants(brainId: string): Promise<AccessGrant[]> {
    const result = await this.pool.query(
      `
        select
          r.brain_id,
          p.provider,
          p.provider_tenant_id,
          p.provider_user_id,
          p.name,
          p.email,
          r.role,
          r.status,
          r.role_source,
          r.upstream_role,
          r.upstream_group_id,
          r.version,
          r.created_at,
          r.updated_at
        from brain.principals p
        join brain.brain_roles r on r.principal_id = p.id
        where r.brain_id = $1
        order by
          case r.role
            when 'owner' then 1
            when 'admin' then 2
            when 'member' then 3
            else 4
          end,
          lower(coalesce(p.name, p.email, p.provider_user_id))
      `,
      [brainId]
    );
    return result.rows.map((row: any) => ({
      brainId: row.brain_id,
      provider: row.provider,
      providerTenantId: row.provider_tenant_id || undefined,
      providerUserId: row.provider_user_id,
      name: row.name || undefined,
      email: row.email || undefined,
      role: row.role,
      status: row.status,
      roleSource: row.role_source || undefined,
      upstreamRole: row.upstream_role || undefined,
      upstreamGroupId: row.upstream_group_id || undefined,
      version: Number(row.version || 1),
      createdAt: row.created_at?.toISOString?.() || String(row.created_at || ""),
      updatedAt: row.updated_at?.toISOString?.() || String(row.updated_at || ""),
    }));
  }

  async countActiveOwners(
    brainId: string,
    provider: string,
    providerTenantId = ""
  ): Promise<number> {
    const result = await this.pool.query(
      `
        select count(*)::int as count
        from brain.brain_roles r
        join brain.principals p on p.id = r.principal_id
        where r.brain_id = $1
          and r.role = 'owner'
          and r.status = 'active'
          and p.provider = $2
          and p.provider_tenant_id = $3
      `,
      [brainId, provider, providerTenantId.trim().toLowerCase()]
    );
    return Number(result.rows[0]?.count || 0);
  }

  async listAuditEvents(brainId: string, limit = 100): Promise<AccessAuditEvent[]> {
    const boundedLimit = Math.max(1, Math.min(250, Math.floor(limit)));
    const result = await this.pool.query(
      `
        select
          a.id,
          a.brain_id,
          a.actor_provider,
          a.actor_tenant_id,
          a.actor_user_id,
          p.provider as target_provider,
          p.provider_tenant_id as target_tenant_id,
          p.provider_user_id as target_user_id,
          p.name as target_name,
          a.action,
          a.old_role,
          a.new_role,
          a.old_status,
          a.new_status,
          a.reason,
          a.graph_outcome,
          a.graph_request_id,
          a.created_at
        from brain.access_audit_events a
        join brain.principals p on p.id = a.target_principal_id
        where a.brain_id = $1
        order by a.created_at desc
        limit $2
      `,
      [brainId, boundedLimit]
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      brainId: row.brain_id,
      actorProvider: row.actor_provider,
      actorTenantId: row.actor_tenant_id || undefined,
      actorUserId: row.actor_user_id,
      targetProvider: row.target_provider,
      targetTenantId: row.target_tenant_id || undefined,
      targetUserId: row.target_user_id,
      targetName: row.target_name || undefined,
      action: row.action,
      oldRole: row.old_role || undefined,
      newRole: row.new_role || undefined,
      oldStatus: row.old_status || undefined,
      newStatus: row.new_status || undefined,
      reason: row.reason || undefined,
      graphOutcome: row.graph_outcome || undefined,
      graphRequestId: row.graph_request_id || undefined,
      createdAt: row.created_at?.toISOString?.() || String(row.created_at || ""),
    }));
  }

  async applyMutation(input: AccessGrantMutation): Promise<AccessGrant> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const brainLock = await client.query(
        `select id from brain.brains where id = $1 for update`,
        [input.brainId]
      );
      if (brainLock.rows.length !== 1) {
        throw new Error(`Unknown Brain for access grant: ${input.brainId}`);
      }
      const principalResult = await client.query(
        `
          insert into brain.principals (
            provider,
            provider_tenant_id,
            provider_user_id,
            login,
            email,
            name,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, now())
          on conflict (provider, provider_tenant_id, provider_user_id) do update
          set login = excluded.login,
              email = excluded.email,
              name = excluded.name,
              updated_at = now()
          returning id
        `,
        [
          input.target.provider,
          normalizedTenant(input.target),
          input.target.providerUserId,
          input.target.login || null,
          input.target.email || null,
          input.target.name || null,
        ]
      );
      const principalId = principalResult.rows[0].id;
      const oldResult = await client.query(
        `
          select role, status, version
          from brain.brain_roles
          where brain_id = $1 and principal_id = $2
          for update
        `,
        [input.brainId, principalId]
      );
      const old = oldResult.rows[0] || null;
      if (
        old?.role === "owner" &&
        old?.status === "active" &&
        (input.role !== "owner" || input.status !== "active")
      ) {
        const countResult = await client.query(
          `
            select count(*)::int as count
            from brain.brain_roles r
            join brain.principals p on p.id = r.principal_id
            where r.brain_id = $1
              and r.role = 'owner'
              and r.status = 'active'
              and p.provider = $2
              and p.provider_tenant_id = $3
          `,
          [input.brainId, input.target.provider, normalizedTenant(input.target)]
        );
        if (Number(countResult.rows[0]?.count || 0) <= 2) {
          throw new Error("Cannot reduce the active Owner roster below two");
        }
      }
      const roleResult = await client.query(
        `
          insert into brain.brain_roles (
            brain_id,
            principal_id,
            role,
            status,
            role_source,
            upstream_role,
            upstream_group_id,
            version,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, 1, now())
          on conflict (brain_id, principal_id) do update
          set role = excluded.role,
              status = excluded.status,
              role_source = excluded.role_source,
              upstream_role = excluded.upstream_role,
              upstream_group_id = excluded.upstream_group_id,
              version = brain.brain_roles.version + 1,
              updated_at = now()
          returning version
        `,
        [
          input.brainId,
          principalId,
          input.role,
          input.status,
          input.roleSource,
          input.upstreamRole || null,
          input.upstreamGroupId || null,
        ]
      );
      const action = !old
        ? "grant"
        : input.status === "suspended" && old.status !== "suspended"
          ? "suspend"
          : input.status === "revoked" && old.status !== "revoked"
            ? "revoke"
            : input.status === "active" && old.status !== "active"
              ? "reinstate"
              : "change";
      await client.query(
        `
          insert into brain.access_audit_events (
            brain_id,
            actor_provider,
            actor_tenant_id,
            actor_user_id,
            target_principal_id,
            action,
            old_role,
            new_role,
            old_status,
            new_status,
            reason,
            graph_outcome,
            graph_request_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `,
        [
          input.brainId,
          input.actor.provider,
          normalizedTenant(input.actor),
          input.actor.providerUserId,
          principalId,
          action,
          old?.role || null,
          input.role,
          old?.status || null,
          input.status,
          input.reason?.slice(0, 500) || null,
          input.graphOutcome?.slice(0, 80) || null,
          input.graphRequestId?.slice(0, 120) || null,
        ]
      );
      await client.query("commit");
      return {
        brainId: input.brainId,
        provider: input.target.provider,
        providerTenantId: input.target.providerTenantId,
        providerUserId: input.target.providerUserId,
        name: input.target.name,
        email: input.target.email,
        role: input.role,
        status: input.status,
        roleSource: input.roleSource,
        upstreamRole: input.upstreamRole,
        upstreamGroupId: input.upstreamGroupId,
        version: Number(roleResult.rows[0]?.version || 1),
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordReconciliation(args: {
    brainId: string;
    actor: BrainPrincipal;
    target: BrainPrincipal;
    reason: string;
    graphOutcome: string;
    graphRequestId?: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `
        select id
        from brain.principals
        where provider = $1
          and provider_tenant_id = $2
          and provider_user_id = $3
      `,
      [args.target.provider, normalizedTenant(args.target), args.target.providerUserId]
    );
    const principalId = result.rows[0]?.id;
    if (!principalId) return;
    await this.pool.query(
      `
        insert into brain.access_audit_events (
          brain_id,
          actor_provider,
          actor_tenant_id,
          actor_user_id,
          target_principal_id,
          action,
          reason,
          graph_outcome,
          graph_request_id
        )
        values ($1, $2, $3, $4, $5, 'reconcile', $6, $7, $8)
      `,
      [
        args.brainId,
        args.actor.provider,
        normalizedTenant(args.actor),
        args.actor.providerUserId,
        principalId,
        args.reason.slice(0, 500),
        args.graphOutcome.slice(0, 80),
        args.graphRequestId?.slice(0, 120) || null,
      ]
    );
  }
}

export async function currentRolesForPrincipal(
  principal: BrainPrincipal
): Promise<Record<string, BrainRole>> {
  if (principal.provider === "stdio" || principal.provider === "system") {
    const registry = await loadRegistry();
    return accessibleRoles(registry, principal);
  }
  if (!usePostgresGrants(principal)) {
    const registry = await loadRegistry();
    return accessibleRoles(registry, principal);
  }
  const roles = await postgresAccessGrantStore().rolesForPrincipal(principal);
  const deploymentBrainId = runtimeBrainId();
  return roles[deploymentBrainId]
    ? { [deploymentBrainId]: roles[deploymentBrainId] }
    : {};
}

export async function hasCurrentAccess(principal: BrainPrincipal): Promise<boolean> {
  return Object.keys(await currentRolesForPrincipal(principal)).length > 0;
}
