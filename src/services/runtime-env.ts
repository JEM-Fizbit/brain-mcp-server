export const LOCAL_STDIO_DEFAULT_BRAIN_ID = "ai-brain-jem";

function enabled(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function runtimeBrainId(
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = env.BRAIN_ID?.trim();
  if (configured) return configured;
  if (env.TRANSPORT === "http") {
    throw new Error("BRAIN_ID is required when TRANSPORT=http");
  }
  return LOCAL_STDIO_DEFAULT_BRAIN_ID;
}

export function assertHttpIdentityConfig(
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.TRANSPORT !== "http") return;
  runtimeBrainId(env);

  const hasLegacyFallback = Boolean(
    env.GITHUB_ALLOWED_LOGINS?.trim() || env.GITHUB_ALLOWED_EMAILS?.trim()
  );
  if (hasLegacyFallback && !enabled(env.BRAIN_GITHUB_ALLOWED_FALLBACK)) {
    throw new Error(
      "GITHUB_ALLOWED_LOGINS/GITHUB_ALLOWED_EMAILS require explicit " +
        "BRAIN_GITHUB_ALLOWED_FALLBACK=1 when TRANSPORT=http"
    );
  }
}
