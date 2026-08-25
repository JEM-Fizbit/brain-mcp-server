import type { EntraProviderConfig } from "../oauth/config.js";
import type { BrainRole } from "../services/registry.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DirectoryUser {
  id: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  userType?: string;
}

export interface GraphMutationResult {
  requestIds: string[];
  removedRoles: BrainRole[];
  addedRole?: BrainRole;
}

function requireObjectId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GUID_RE.test(normalized)) throw new Error("Target Entra object ID must be a GUID");
  return normalized;
}

function safeGraphError(status: number, requestId?: string | null): Error {
  return new Error(
    `Microsoft Graph membership request failed with HTTP ${status}${
      requestId ? ` (request ${requestId.slice(0, 120)})` : ""
    }`
  );
}

export class EntraGraphClient {
  constructor(
    private readonly entra: EntraProviderConfig,
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private groupId(role: BrainRole): string {
    const value = this.entra.roleGroupIds[role];
    if (!value || !GUID_RE.test(value)) {
      throw new Error(`Managed Entra group is not configured for role ${role}`);
    }
    return value.toLowerCase();
  }

  private async request(
    pathname: string,
    init: RequestInit = {},
    accepted: number[] = [200]
  ): Promise<{ response: Response; requestId?: string }> {
    if (!pathname.startsWith("/")) throw new Error("Graph path must be absolute");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetchImpl(`${GRAPH_BASE}${pathname}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.accessToken}`,
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      const requestId =
        response.headers.get("request-id") ||
        response.headers.get("client-request-id") ||
        undefined;
      if (!accepted.includes(response.status)) {
        throw safeGraphError(response.status, requestId);
      }
      return { response, requestId };
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchUsers(query: string): Promise<DirectoryUser[]> {
    const term = query.trim().replace(/["\\]/g, "").slice(0, 80);
    if (term.length < 2) return [];
    const params = new URLSearchParams({
      "$search": `"displayName:${term}" OR "mail:${term}" OR "userPrincipalName:${term}"`,
      "$select": "id,displayName,mail,userPrincipalName,userType",
      "$top": "20",
      "$count": "true",
    });
    const { response } = await this.request(`/users?${params.toString()}`, {
      headers: { ConsistencyLevel: "eventual" },
    });
    const json = (await response.json()) as { value?: DirectoryUser[] };
    return (json.value || [])
      .filter((user) => GUID_RE.test(user.id))
      .map((user) => ({
        id: user.id.toLowerCase(),
        displayName: user.displayName,
        mail: user.mail,
        userPrincipalName: user.userPrincipalName,
        userType: user.userType,
      }));
  }

  async getUser(objectId: string): Promise<DirectoryUser> {
    const target = requireObjectId(objectId);
    const params = new URLSearchParams({
      "$select": "id,displayName,mail,userPrincipalName,userType",
    });
    const { response } = await this.request(`/users/${target}?${params.toString()}`);
    const user = (await response.json()) as DirectoryUser;
    if (!user.id || user.id.toLowerCase() !== target) {
      throw new Error("Microsoft Graph returned an unexpected directory identity");
    }
    return {
      id: target,
      displayName: user.displayName,
      mail: user.mail,
      userPrincipalName: user.userPrincipalName,
      userType: user.userType,
    };
  }

  async rolesForUser(objectId: string): Promise<BrainRole[]> {
    const target = requireObjectId(objectId);
    const roleGroupIds = Object.fromEntries(
      (["reader", "member", "admin", "owner"] as BrainRole[]).map((role) => [
        role,
        this.groupId(role),
      ])
    ) as Record<BrainRole, string>;
    // App-role groups are managed as direct membership. Do not use
    // checkMemberGroups here: it is transitive and could make a nested-group
    // relationship appear to be a Brain grant even though group-based app-role
    // assignment does not use that relationship as our authority boundary.
    const memberships = new Set<string>();
    let pathname = `/users/${target}/memberOf/microsoft.graph.group?$select=id&$top=999`;
    for (let page = 0; page < 10 && pathname; page += 1) {
      const { response } = await this.request(pathname);
      const json = (await response.json()) as {
        value?: Array<{ id?: string }>;
        "@odata.nextLink"?: string;
      };
      for (const item of json.value || []) {
        if (item.id && GUID_RE.test(item.id)) memberships.add(item.id.toLowerCase());
      }
      const nextLink = json["@odata.nextLink"];
      if (!nextLink) {
        pathname = "";
      } else {
        const next = new URL(nextLink);
        if (next.origin !== "https://graph.microsoft.com" || !next.pathname.startsWith("/v1.0/")) {
          throw new Error("Microsoft Graph returned an unsafe membership continuation URL");
        }
        pathname = `${next.pathname.slice("/v1.0".length)}${next.search}`;
      }
    }
    if (pathname) throw new Error("Microsoft Graph membership result exceeded the safety page limit");
    return (["reader", "member", "admin", "owner"] as BrainRole[]).filter(
      (role) => memberships.has(roleGroupIds[role])
    );
  }

  async setRole(objectId: string, role: BrainRole): Promise<GraphMutationResult> {
    const target = requireObjectId(objectId);
    const desiredGroupId = this.groupId(role);
    const requestIds: string[] = [];
    const added = await this.request(
      `/groups/${desiredGroupId}/members/$ref`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "@odata.id": `${GRAPH_BASE}/directoryObjects/${target}`,
        }),
      },
      [204, 400]
    );
    const desiredMembershipWasAdded = added.response.status === 204;
    if (added.response.status === 400) {
      // Graph returns 400 when the direct membership already exists. Confirm it
      // instead of accepting an arbitrary bad request as idempotent success.
      const current = await this.rolesForUser(target);
      if (!current.includes(role)) throw safeGraphError(400, added.requestId);
    }
    if (added.requestId) requestIds.push(added.requestId);

    const removedRoles: BrainRole[] = [];
    try {
      for (const other of ["reader", "member", "admin", "owner"] as BrainRole[]) {
        if (other === role) continue;
        const result = await this.request(
          `/groups/${this.groupId(other)}/members/${target}/$ref`,
          { method: "DELETE" },
          [204, 404]
        );
        if (result.response.status === 204) removedRoles.push(other);
        if (result.requestId) requestIds.push(result.requestId);
      }
    } catch (error) {
      if (desiredMembershipWasAdded) {
        await this.request(
          `/groups/${desiredGroupId}/members/${target}/$ref`,
          { method: "DELETE" },
          [204, 404]
        ).catch(() => undefined);
      }
      throw error;
    }
    return { requestIds, removedRoles, addedRole: role };
  }

  async removeAllRoles(objectId: string): Promise<GraphMutationResult> {
    const target = requireObjectId(objectId);
    const requestIds: string[] = [];
    const removedRoles: BrainRole[] = [];
    for (const role of ["reader", "member", "admin", "owner"] as BrainRole[]) {
      const result = await this.request(
        `/groups/${this.groupId(role)}/members/${target}/$ref`,
        { method: "DELETE" },
        [204, 404]
      );
      if (result.response.status === 204) removedRoles.push(role);
      if (result.requestId) requestIds.push(result.requestId);
    }
    return { requestIds, removedRoles };
  }
}
