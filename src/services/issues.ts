import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GITHUB_REPO } from "../constants.js";

const exec = promisify(execFile);

export interface OpenIssue {
  number: number;
  title: string;
  url: string;
}

/**
 * Check for open maintenance issues on the Brain repo.
 * Returns an empty array if gh CLI is unavailable or no issues exist.
 */
export async function getOpenMaintenanceIssues(): Promise<OpenIssue[]> {
  try {
    const { stdout } = await exec("gh", [
      "issue",
      "list",
      "--repo",
      GITHUB_REPO,
      "--label",
      "maintenance",
      "--state",
      "open",
      "--json",
      "number,title,url",
    ]);

    const issues = JSON.parse(stdout) as OpenIssue[];
    return issues;
  } catch {
    // gh CLI not available or not authenticated — fail silently
    return [];
  }
}
