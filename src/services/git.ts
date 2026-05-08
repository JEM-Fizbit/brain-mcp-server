import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BRAIN_DIR } from "../constants.js";

const exec = promisify(execFile);

async function git(...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: BRAIN_DIR });
  return stdout.trim();
}

async function unpushedCommitCount(): Promise<number | null> {
  try {
    const out = await git("rev-list", "--count", "@{u}..HEAD");
    return parseInt(out, 10);
  } catch {
    return null;
  }
}

export async function commit(
  message: string,
  push: boolean
): Promise<string> {
  await git("add", "-A");

  const status = await git("status", "--porcelain");
  const hasChanges = Boolean(status);

  if (!hasChanges) {
    if (!push) {
      return "No changes to commit.";
    }
    const ahead = await unpushedCommitCount();
    if (ahead === null) {
      return "No changes to commit; no upstream configured. Run `git push -u origin <branch>` once to set upstream, then retry.";
    }
    if (ahead === 0) {
      return "No changes to commit; nothing to push.";
    }
    await git("push");
    const noun = ahead === 1 ? "commit" : "commits";
    return `No new changes. Pushed ${ahead} existing local ${noun} to origin.`;
  }

  await git("commit", "-m", message);

  const hash = await git("rev-parse", "--short", "HEAD");
  const diffStat = await git("diff", "--stat", "HEAD~1", "HEAD");
  const statMatch = diffStat.match(/(\d+) files? changed/);
  const filesChanged = statMatch ? parseInt(statMatch[1], 10) : 1;

  let pushStatus: string;
  if (push) {
    await git("push");
    pushStatus = "Pushed to origin.";
  } else {
    pushStatus = "Not pushed.";
  }

  return `Committed ${hash}: ${filesChanged} files changed. ${pushStatus}`;
}

export async function getStatus(): Promise<string> {
  const [branch, status, lastCommit] = await Promise.all([
    git("branch", "--show-current"),
    git("status", "--porcelain"),
    git("log", "-1", "--format=%h %s (%ar)").catch(() => "No commits yet"),
  ]);

  const clean = status ? "dirty" : "clean";
  return `Branch: ${branch} (${clean})\nLast commit: ${lastCommit}`;
}
