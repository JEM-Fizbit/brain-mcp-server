import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BRAIN_DIR } from "../constants.js";

const exec = promisify(execFile);

async function git(...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: BRAIN_DIR });
  return stdout.trim();
}

export async function commit(
  message: string,
  push: boolean
): Promise<string> {
  // Stage all changes
  await git("add", "-A");

  // Check if there's anything to commit
  const status = await git("status", "--porcelain");
  if (!status) {
    return "No changes to commit.";
  }

  // Commit
  await git("commit", "-m", message);

  // Get commit info
  const hash = await git("rev-parse", "--short", "HEAD");
  const diffStat = await git("diff", "--stat", "HEAD~1", "HEAD");
  const statMatch = diffStat.match(/(\d+) files? changed/);
  const filesChanged = statMatch ? parseInt(statMatch[1], 10) : 1;

  // Optionally push
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
