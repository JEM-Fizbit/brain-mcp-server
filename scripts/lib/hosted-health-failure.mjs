const LOCAL_CONNECTIVITY_PATTERN =
  /fetch failed|network|offline|timeout|timed out|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i;

export function hostedHealthFailureDetails(error, baseUrl) {
  const cause = error?.cause || {};
  const code = cause.code || error?.code || "";
  const causeMessage = cause.message || "";
  const combined = [
    error?.name,
    error?.message,
    cause?.name,
    causeMessage,
    code,
  ]
    .filter(Boolean)
    .join(" ");
  const localConnectivity = LOCAL_CONNECTIVITY_PATTERN.test(combined);
  const details = {
    baseUrl,
    error: error?.message || "hosted health request failed",
    ...(causeMessage ? { cause: causeMessage } : {}),
    ...(code ? { code } : {}),
    connectivity: "unreachable",
  };

  if (localConnectivity) {
    return {
      ...details,
      faultDomain: "local_connectivity",
      diagnosis:
        "The local device could not reach the hosted Brain endpoint. Check Wi-Fi, VPN, DNS, or local network access before treating this as a Brain MCP stack fault.",
    };
  }

  return {
    ...details,
    faultDomain: "hosted_stack",
    diagnosis:
      "The hosted Brain endpoint did not return health. Treat as a hosted stack fault if local network access is otherwise working.",
  };
}
