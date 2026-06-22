// Classify a Postgres connection URL by Supabase pooler mode, without exposing
// credentials. Used by the HTTP server startup warning and the hosted doctor to
// flag the session-mode pooler, whose hard per-project client cap (pool_size,
// ~15) is shared across every client (hosted runtime pool + telemetry pool +
// local sync daemon + operator scripts) and exhausts under concurrent load with
// "EMAXCONNSESSION: max clients reached in session mode". App/short-query
// workloads belong on the transaction pooler (:6543). See docs/deploy-fly.md and
// ai-knowledge/protocols/SUPABASE_BEST_PRACTICES.md § Connection Pooler.

export type PoolerMode = "transaction" | "session" | "direct" | "unknown";

export interface PoolerClassification {
  mode: PoolerMode;
  host: string | null;
  port: number | null;
  /** Human-readable summary, credential-free — safe to log/report. */
  label: string;
}

export function classifyPoolerUrl(url: string | undefined | null): PoolerClassification {
  if (!url) return { mode: "unknown", host: null, port: null, label: "no database url set" };

  let host: string | null = null;
  let port: number | null = null;
  try {
    const parsed = new URL(url);
    host = parsed.hostname || null;
    port = parsed.port ? Number(parsed.port) : 5432;
  } catch {
    const match = url.match(/@([^/:?]+):(\d+)/);
    if (match) {
      host = match[1];
      port = Number(match[2]);
    }
  }

  if (host && /\.pooler\.supabase\.com$/i.test(host)) {
    if (port === 6543) return { mode: "transaction", host, port, label: "Supabase transaction pooler (:6543)" };
    if (port === 5432) return { mode: "session", host, port, label: "Supabase session pooler (:5432)" };
    return { mode: "unknown", host, port, label: `Supabase pooler (:${port ?? "?"})` };
  }
  if (host && /\.supabase\.co$/i.test(host)) {
    return { mode: "direct", host, port, label: "Supabase direct connection" };
  }
  return { mode: "unknown", host, port, label: host ? `${host}:${port ?? "?"}` : "unparsed database url" };
}

/** True when the URL is the session-mode pooler — the app-workload exhaustion risk. */
export function isSessionPoolerRisk(url: string | undefined | null): boolean {
  return classifyPoolerUrl(url).mode === "session";
}
