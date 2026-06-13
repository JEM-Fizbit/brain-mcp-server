import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getBrainPaths } from "./registry.js";

const exec = promisify(execFile);

async function git(brainId: string | undefined, ...args: string[]): Promise<string> {
  const { repoPath } = await getBrainPaths(brainId);
  const { stdout } = await exec("git", args, { cwd: repoPath });
  return stdout.trim();
}

async function unpushedCommitCount(brainId?: string): Promise<number | null> {
  try {
    const out = await git(brainId, "rev-list", "--count", "@{u}..HEAD");
    return parseInt(out, 10);
  } catch {
    return null;
  }
}

export async function commit(
  message: string,
  push: boolean,
  brainId?: string,
  authorIdentity?: string
): Promise<string> {
  await git(brainId, "add", "-A");

  const status = await git(brainId, "status", "--porcelain");
  const hasChanges = Boolean(status);

  if (!hasChanges) {
    if (!push) {
      return "No changes to commit.";
    }
    const ahead = await unpushedCommitCount(brainId);
    if (ahead === null) {
      return "No changes to commit; no upstream configured. Run `git push -u origin <branch>` once to set upstream, then retry.";
    }
    if (ahead === 0) {
      return "No changes to commit; nothing to push.";
    }
    await git(brainId, "push");
    const noun = ahead === 1 ? "commit" : "commits";
    return `No new changes. Pushed ${ahead} existing local ${noun} to origin.`;
  }

  const commitArgs = authorIdentity
    ? ["commit", "--author", authorIdentity, "-m", message]
    : ["commit", "-m", message];
  await git(brainId, ...commitArgs);

  const hash = await git(brainId, "rev-parse", "--short", "HEAD");
  const diffStat = await git(brainId, "diff", "--stat", "HEAD~1", "HEAD");
  const statMatch = diffStat.match(/(\d+) files? changed/);
  const filesChanged = statMatch ? parseInt(statMatch[1], 10) : 1;

  let pushStatus: string;
  if (push) {
    await git(brainId, "push");
    pushStatus = "Pushed to origin.";
  } else {
    pushStatus = "Not pushed.";
  }

  return `Committed ${hash}: ${filesChanged} files changed. ${pushStatus}`;
}

export async function getStatus(): Promise<string> {
  return getStatusForBrain();
}

export async function getStatusForBrain(brainId?: string): Promise<string> {
  const [branch, status, lastCommit] = await Promise.all([
    git(brainId, "branch", "--show-current"),
    git(brainId, "status", "--porcelain"),
    git(brainId, "log", "-1", "--format=%h %s (%ar)").catch(() => "No commits yet"),
  ]);

  const clean = status ? "dirty" : "clean";
  return `Branch: ${branch} (${clean})\nLast commit: ${lastCommit}`;
}
