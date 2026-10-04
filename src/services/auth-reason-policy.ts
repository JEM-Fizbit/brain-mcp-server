// Pure metadata classification shared by Slack and Doctor. Unknown/incomplete
// evidence stays actionable; only explicitly missing bearer tokens are separated.
export function classifyAuthReasons(input: {
  failureCount: number;
  reasons: Array<{ reason: string; n?: number; count?: number }>;
  warnThreshold: number;
  failThreshold: number;
  staleConnector?: boolean;
}) {
  const total = Math.max(0, input.failureCount);
  const anonymousCount = Math.min(total, input.reasons
    .filter(r => r.reason === "missing_bearer")
    .reduce((n, r) => n + Math.max(0, Number(r.n ?? r.count) || 0), 0));
  const credentialCount = total - anonymousCount;
  const credentialStatus = input.failThreshold > 0 && credentialCount >= input.failThreshold
    ? (input.staleConnector ? "warn" : "fail")
    : input.warnThreshold > 0 && credentialCount >= input.warnThreshold ? "warn" : credentialCount > 0 ? "info" : "pass";
  // The existing fail-count threshold becomes an anonymous-activity review
  // threshold, never proof of rejected credentials or an unusable Brain.
  const anonymousStatus = input.failThreshold > 0 && anonymousCount >= input.failThreshold ? "warn" : anonymousCount > 0 ? "info" : "pass";
  const rank = { pass: 0, info: 1, warn: 2, fail: 3 };
  const effectiveStatus = rank[credentialStatus] >= rank[anonymousStatus] ? credentialStatus : anonymousStatus;
  return { anonymousCount, credentialCount, credentialStatus, anonymousStatus, effectiveStatus };
}
