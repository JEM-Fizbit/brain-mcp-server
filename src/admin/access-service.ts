import type { EntraProviderConfig } from "../oauth/config.js";
import { BRAIN_ROLE_TO_APP_ROLE } from "../oauth/entra.js";
import {
  type AccessGrant,
  type GrantStatus,
  PostgresAccessGrantStore,
} from "../services/access-grants.js";
import type { BrainPrincipal, BrainRole } from "../services/registry.js";
import { EntraGraphClient, type DirectoryUser, type GraphMutationResult } from "./entra-graph.js";

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_RANK: Record<BrainRole, number> = {
  reader: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export interface AccessMutationRequest {
  target: DirectoryUser;
  role: BrainRole;
  status: GrantStatus;
  reason?: string;
  confirmed: boolean;
}

export interface GrantWithDrift extends AccessGrant {
  graphRoles: BrainRole[];
  drift: "none" | "missing" | "multiple" | "mismatch" | "unexpected" | "unavailable";
}

export class AccessReconciliationError extends Error {
  constructor(
    message: string,
    readonly phase:
      | "local_committed_graph_failed"
      | "graph_committed_local_failed"
      | "graph_partial_local_unchanged",
    readonly requestIds: string[] = []
  ) {
    super(message);
  }
}

function targetPrincipal(tenantId: string, user: DirectoryUser): BrainPrincipal {
  if (!GUID_RE.test(user.id)) throw new Error("Target Entra object ID must be a GUID");
  return {
    provider: "entra",
    providerTenantId: tenantId,
    providerUserId: user.id.toLowerCase(),
    login: user.userPrincipalName,
    email: user.mail,
    name: user.displayName,
  };
}

function driftFor(grant: AccessGrant, graphRoles: BrainRole[]): GrantWithDrift["drift"] {
  if (grant.status !== "active") return graphRoles.length === 0 ? "none" : "unexpected";
  if (graphRoles.length === 0) return "missing";
  if (graphRoles.length > 1) return "multiple";
  return graphRoles[0] === grant.role ? "none" : "mismatch";
}

export class AccessAdministrationService {
  constructor(
    private readonly brainId: string,
    private readonly entra: EntraProviderConfig,
    private readonly grants: PostgresAccessGrantStore
  ) {}

  graph(accessToken: string): EntraGraphClient {
    return new EntraGraphClient(this.entra, accessToken);
  }

  async list(accessToken: string): Promise<GrantWithDrift[]> {
    const graph = this.graph(accessToken);
    const grants = await this.grants.listGrants(this.brainId);
    const tenantId = this.entra.tenantId.toLowerCase();
    const entraGrants = grants.filter(
      (grant) =>
        grant.provider === "entra" &&
        (grant.providerTenantId || "").toLowerCase() === tenantId &&
        GUID_RE.test(grant.providerUserId)
    );
    let graphRoles: Map<string, BrainRole[]> | undefined;
    try {
      graphRoles = await graph.rolesForUsers(entraGrants.map((grant) => grant.providerUserId));
    } catch {
      // Drift is unavailable as a unit when any managed group cannot be read.
      // The local projection remains authoritative and no access is widened.
    }
    return grants.map((grant) => {
      const roles = graphRoles?.get(grant.providerUserId.toLowerCase());
      return roles
        ? { ...grant, graphRoles: roles, drift: driftFor(grant, roles) }
        : { ...grant, graphRoles: [], drift: "unavailable" as const };
    });
  }

  async mutate(
    actor: BrainPrincipal,
    accessToken: string,
    request: AccessMutationRequest
  ): Promise<{ grant: AccessGrant; graph: GraphMutationResult }> {
    if (!request.confirmed) throw new Error("Explicit confirmation is required");
    if (!["reader", "member", "admin", "owner"].includes(request.role)) {
      throw new Error("Invalid Brain role");
    }
    if (!["active", "suspended", "revoked"].includes(request.status)) {
      throw new Error("Invalid grant status");
    }
    const requestedTarget = targetPrincipal(this.entra.tenantId, request.target);
    const current = await this.grants.getGrant(this.brainId, requestedTarget);
    const graph = this.graph(accessToken);
    if (request.status !== "active" && !current) {
      throw new Error("A current grant is required before access can be suspended or revoked");
    }
    const target = request.status === "active"
      ? targetPrincipal(this.entra.tenantId, await graph.getUser(requestedTarget.providerUserId))
      : {
          ...requestedTarget,
          name: current?.name,
          email: current?.email,
        };
    const localFirst = Boolean(
      current &&
        (request.status !== "active" ||
          (current.status === "active" && ROLE_RANK[request.role] < ROLE_RANK[current.role]))
    );
    const upstreamGroupId = this.entra.roleGroupIds[request.role];
    if (!upstreamGroupId) throw new Error(`No managed group is configured for ${request.role}`);
    const reason = request.reason?.trim().slice(0, 500) || "Owner-confirmed access change";

    const applyLocal = (outcome: string, result?: GraphMutationResult) =>
      this.grants.applyMutation({
        brainId: this.brainId,
        target,
        role: request.role,
        status: request.status,
        roleSource: "entra_group",
        upstreamRole: BRAIN_ROLE_TO_APP_ROLE[request.role],
        upstreamGroupId,
        actor,
        reason,
        graphOutcome: outcome,
        graphRequestId: result?.requestIds[0],
      });
    const mutateGraph = () =>
      request.status === "active"
        ? graph.setRole(target.providerUserId, request.role)
        : graph.removeAllRoles(target.providerUserId);

    if (localFirst) {
      const local = await applyLocal("pending");
      try {
        const graphResult = await mutateGraph();
        await this.grants.recordReconciliation({
          brainId: this.brainId,
          actor,
          target,
          reason: "Graph membership confirmed after fail-closed local change",
          graphOutcome: "success",
          graphRequestId: graphResult.requestIds[0],
        });
        return { grant: local, graph: graphResult };
      } catch (error) {
        await this.grants.recordReconciliation({
          brainId: this.brainId,
          actor,
          target,
          reason: "Graph membership change failed after local grant was restricted",
          graphOutcome: "failed",
        });
        throw new AccessReconciliationError(
          "Local access is safely restricted, but Microsoft Graph did not complete. Reconcile the managed groups before closing this incident.",
          "local_committed_graph_failed"
        );
      }
    }

    let graphResult: GraphMutationResult;
    try {
      graphResult = await mutateGraph();
    } catch {
      throw new AccessReconciliationError(
        "Microsoft Graph did not complete and the new access remains locally denied. Check the four managed groups before retrying.",
        "graph_partial_local_unchanged"
      );
    }
    try {
      const local = await applyLocal("success", graphResult);
      return { grant: local, graph: graphResult };
    } catch (error) {
      let rollbackIds: string[] = [];
      try {
        rollbackIds = (await graph.removeAllRoles(target.providerUserId)).requestIds;
      } catch {
        // The local projection still denies the new/elevated role. Surface the
        // outstanding managed-group membership as an explicit incident.
      }
      throw new AccessReconciliationError(
        "Microsoft Graph changed, but the local grant did not commit. The new access remains locally denied; reconcile the managed groups immediately.",
        "graph_committed_local_failed",
        [...graphResult.requestIds, ...rollbackIds]
      );
    }
  }
}
