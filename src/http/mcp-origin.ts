import type { IncomingMessage } from "node:http";

/** Fixed deployment policy, never derived from Host, forwarded headers or DCR. */
export function buildMcpAllowedOrigins(
  resourceUri: string,
  extraOrigins = process.env.MCP_ALLOWED_ORIGINS
): readonly string[] {
  const resource = new URL(resourceUri);
  if (!["http:", "https:"].includes(resource.protocol)) {
    throw new Error("MCP resource URI must use HTTP or HTTPS");
  }
  const allowed = new Set([resource.origin]);
  if (extraOrigins?.trim()) {
    for (const value of extraOrigins.split(",")) {
      const origin = value.trim();
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error("MCP_ALLOWED_ORIGINS must contain exact HTTP(S) origins");
      }
      if (!["http:", "https:"].includes(parsed.protocol) ||
        parsed.origin !== origin || parsed.hostname.includes("*")) {
        throw new Error("MCP_ALLOWED_ORIGINS must contain exact HTTP(S) origins");
      }
      allowed.add(origin);
    }
  }
  return [...allowed];
}

export function isAllowedMcpOrigin(
  req: Pick<IncomingMessage, "headers" | "rawHeaders">,
  allowed: readonly string[]
): boolean {
  // Reject duplicate fields even if Node or a proxy combines their values.
  let count = 0;
  for (let i = 0; i < (req.rawHeaders?.length || 0); i += 2) {
    if (req.rawHeaders[i].toLowerCase() === "origin") count++;
  }
  if (count > 1) return false;
  const origin = req.headers.origin;
  // Native/server-side clients normally omit Origin. Bearer auth still applies.
  if (origin === undefined) return count === 0;
  return typeof origin === "string" && allowed.includes(origin);
}
