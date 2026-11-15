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

export function authAlertGuidance(anonymous: boolean, urgent: boolean) {
  if (anonymous) {
    return {
      title: "Requests without access tokens blocked",
      verdict: "Review threshold reached",
      subject: "Requests without access tokens",
      outcome: "blocked",
      impact: "Brain blocked every request in this alert. The sender is unknown.",
      action: "No immediate action. If these notices recur, check whether a known monitor or connector is sending requests without a token.",
      phoneAction: "No immediate action.",
    };
  }
  return {
    title: "Brain sign-in errors",
    verdict: urgent ? "Check your connector now" : "Check your connector",
    subject: "Authentication requests",
    outcome: "rejected",
    impact: "A connector may be unable to sign in to Brain.",
    action: "Try a normal Brain action in your connector. Reconnect it only if you see a sign-in error.",
    phoneAction: "Test your connector. Reconnect if sign-in fails.",
  };
}
