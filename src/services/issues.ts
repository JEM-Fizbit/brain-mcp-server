import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GITHUB_REPO } from "../constants.js";

const exec = promisify(execFile);

export interface OpenIssue {
  number: number;
  title: string;
  url: string;
}

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
let cache: { issues: OpenIssue[]; timestamp: number } | null = null;

/**
 * Check for open maintenance issues on the Brain repo.
 * Returns an empty array if gh CLI is unavailable or no issues exist.
 * Results are cached for 10 minutes to avoid repeated network calls.
 */
export async function getOpenMaintenanceIssues(): Promise<OpenIssue[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache.issues;
  }

  try {
    const { stdout } = await exec(
      "gh",
      [
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
      ],
      { timeout: 5000 }
    );

    const issues = JSON.parse(stdout) as OpenIssue[];
    cache = { issues, timestamp: Date.now() };
    return issues;
  } catch {
    // gh CLI not available, not authenticated, or timed out — fail silently
    return [];
  }
}
