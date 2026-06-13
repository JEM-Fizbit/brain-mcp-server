import * as git from "./git.js";

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value || "").toLowerCase());
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function autoSyncEnabled(): boolean {
  return truthy(process.env.BRAIN_AUTO_SYNC);
}

export function autoPushEnabled(): boolean {
  if (process.env.BRAIN_AUTO_PUSH === undefined) return true;
  return truthy(process.env.BRAIN_AUTO_PUSH);
}

export function autoSyncMessage(prefix: string, subject: string): string {
  const cleanSubject = oneLine(subject).slice(0, 120);
  return cleanSubject ? `${prefix}: ${cleanSubject}` : prefix;
}

export async function maybeAutoSync(
  brainId: string | undefined,
  message: string,
  authorIdentity?: string
): Promise<string> {
  if (!autoSyncEnabled()) return "";

  const result = await git.commit(
    message,
    autoPushEnabled(),
    brainId,
    authorIdentity
  );
  return `\n\nAuto-sync: ${result}`;
}
