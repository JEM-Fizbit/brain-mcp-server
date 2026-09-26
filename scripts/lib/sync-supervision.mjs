// Read-only interpretation; recovery actions belong to the independent worker
// supervisor. A stale file or a different supervisor PID is never healthy.
export function evaluateSupervision(value, { brainId, supervisorPid, now = Date.now(), expected = false } = {}) {
  if (!value) return { status: expected ? 'warn' : 'info', state: 'unobserved' };
  const age = now - Date.parse(value.checkedAt);
  if (value.brainId !== brainId || value.supervisorPid !== supervisorPid || !Number.isFinite(age) || age < 0 || age > 120000) {
    return { status: 'warn', state: 'stale_or_mismatched' };
  }
  return { status: value.state === 'needs_attention' ? 'fail' : value.state === 'running' ? 'pass' : 'warn',
    state: value.state, reason: value.reason, attempts: value.attempts,
    maxRestarts: value.maxRestarts, workerPid: value.workerPid,
    lastStage: value.lastStage, lastSuccessAt: value.lastSuccessAt,
    nextRetryAt: value.nextRetryAt, history: (value.history || []).slice(-10) };
}
