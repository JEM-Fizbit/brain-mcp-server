import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DAY_MS = 86400000;
export function validLintAssessment(payload, brainId) {
  return payload?.version === 2 && payload.brainId === brainId &&
    Number.isFinite(Date.parse(payload.checkedAt)) &&
    payload.report && ["bloat", "stale", "orphans", "drift", "largeDomainPacks", "unindexedWorkingBinaries"]
      .every(key => Array.isArray(payload.report[key])) &&
    Number.isInteger(payload.issueCount) && payload.issueCount >= 0;
}

export async function readLintCache(file, brainId) {
  try {
    const payload = JSON.parse(await fs.readFile(file, "utf8"));
    return payload?.version === 2 && payload.brainId === brainId ? payload : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// Metadata only; source companions are not vault lint inputs. Include tombstones
// so deletion and recreation invalidate the assessment. Never read LOG prose.
export async function hostedLintFingerprint(pool, brainId, binding, lintConfig) {
  const result = await pool.query(`
    select f.filename, f.current_revision_id::text as revision_id
    from brain.brain_files f
    where f.brain_id = $1 and f.filename not like 'sources/%'
    order by f.filename
  `, [brainId]);
  return crypto.createHash("sha256").update(JSON.stringify({
    // Bump when assessment/fix semantics change, even if hosted content does not.
    version: 2, brainId, binding, lintConfig, heads: result.rows,
  })).digest("hex");
}

export async function writeLintCache(file, payload) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.next`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporary, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

// Doctor and explicit Maintenance share one lock. An interrupted Doctor's lock
// is reclaimable by PID; time alone never steals a live assessment's lock.
async function acquireLock(file) {
  const lock = `${file}.lock`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lock, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      return async () => { await handle.close(); await fs.rm(lock, { force: true }); };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(await fs.readFile(lock, "utf8").catch(() => ""));
      if (!Number.isInteger(pid) || pid < 1) return null;
      try { process.kill(pid, 0); return null; }
      catch (error) {
        if (error.code !== "ESRCH") return null;
        await fs.rm(lock, { force: true });
      }
    }
  }
  return null;
}

export async function refreshLintCache({ file, brainId, getFingerprint, assess,
  source, force = false, now = () => Date.now(), maxAgeMs = DAY_MS }) {
  const observedAt = new Date(now()).toISOString();
  let previous = await readLintCache(file, brainId).catch(() => null);
  const unavailable = (state, reason) => ({
    ...(previous || { version: 2, brainId, checkedAt: null }),
    observation: { state, observedAt, reason },
  });
  const release = await acquireLock(file);
  if (!release) return unavailable("unobserved", "assessment_in_progress");
  try {
    previous = await readLintCache(file, brainId).catch(() => null);
    const fingerprint = await getFingerprint();
    const age = now() - Date.parse(previous?.checkedAt);
    if (!force && validLintAssessment(previous, brainId) &&
        previous.fingerprint === fingerprint && age >= 0 && age < maxAgeMs) {
      const payload = { ...previous, observation: { state: "fresh", observedAt } };
      await writeLintCache(file, payload);
      return payload;
    }
    const payload = await assess();
    if (!validLintAssessment(payload, brainId)) throw new Error("invalid_lint_assessment");
    const previousTime = Date.parse(previous?.checkedAt);
    if (previousTime <= now() && Date.parse(payload.checkedAt) < previousTime) {
      const result = unavailable("stale", "older_assessment_rejected");
      await writeLintCache(file, result);
      return result;
    }
    if (await getFingerprint() !== fingerprint) {
      const result = unavailable("stale", "content_changed_during_assessment");
      await writeLintCache(file, result);
      return result;
    }
    const result = { ...payload, fingerprint, source,
      assessmentScope: "hosted_synced_markdown",
      observation: { state: "fresh", observedAt: new Date(now()).toISOString() } };
    await writeLintCache(file, result);
    return result;
  } catch {
    // Do not expose database errors or content. Preserve the last good report
    // with its original timestamp, explicitly disqualifying it as current.
    const result = unavailable("failed", "hosted_assessment_failed");
    await writeLintCache(file, result);
    return result;
  } finally { await release(); }
}
