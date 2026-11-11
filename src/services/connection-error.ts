/** Recognize transport failures without inspecting/logging a pg client object. */
const NETWORK_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH",
  "ENETUNREACH", "ENETDOWN", "EADDRNOTAVAIL", "ETIMEDOUT", "EPIPE",
]);

export function retryableConnectionCode(error: unknown): string | null {
  const seen = new Set<unknown>();
  let remaining = 32;
  const visit = (value: any, depth: number): string | null => {
    if (--remaining < 0 || depth > 8 || value == null || seen.has(value)) return null;
    if (typeof value === "object") seen.add(value);
    const code = typeof value.code === "string" ? value.code : "";
    // An explicit non-network code (e.g. authentication/permission) wins over
    // wrapper prose and causes. Never retry a mixed aggregate indefinitely.
    if (code && !NETWORK_CODES.has(code)) return null;
    const children = Array.isArray(value.errors) ? [...value.errors] : [];
    if (value.cause != null) children.push(value.cause);
    if (children.length) {
      if (children.length > 32) return null;
      const codes = children.map(child => visit(child, depth + 1));
      return codes.every(Boolean) ? codes[0] : null;
    }
    if (Array.isArray(value.errors)) return null; // Empty aggregate is unknown.
    if (NETWORK_CODES.has(code)) return code;
    const message = typeof value === "string" ? value : String(value.message || "");
    for (const known of NETWORK_CODES) if (new RegExp(`\\b${known}\\b`).test(message)) return known;
    if (/getaddrinfo/i.test(message)) return "ENOTFOUND";
    if (/connection terminated|connection refused|socket hang up/i.test(message)) return "ECONNRESET";
    if (/timeout exceeded when trying to connect|query read timeout/i.test(message)) return "ETIMEDOUT";
    return null;
  };
  return visit(error, 0);
}

/** Only bounded identifiers; never serialize Error.client, parameters or causes. */
export function connectionErrorMetadata(error: any) {
  const retryCode = retryableConnectionCode(error);
  const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : null;
  return {
    name: identifier(error?.name) || "Error",
    code: retryCode || identifier(error?.code),
    networkRetryable: retryCode !== null,
  };
}
