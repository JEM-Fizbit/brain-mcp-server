import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "./lib/load-local-env.mjs";
import {
  assertReleaseState,
  buildFlyDeployArgs,
  buildProvenanceRecord,
} from "./lib/release-contract.mjs";

loadLocalEnv();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const flyApp = process.env.BRAIN_FLY_APP?.trim();
const flyBin = process.env.BRAIN_FLY_BIN?.trim() || "flyctl";
const provenanceFile = path.resolve(
  repoRoot,
  process.env.BRAIN_DEPLOY_PROVENANCE_FILE || ".brain-deploy/provenance.jsonl"
);

function run(command, args, options = {}) {
  const output = execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return typeof output === "string" ? output.trim() : "";
}

function releaseState() {
  const porcelain = run("git", ["status", "--porcelain"], { capture: true });
  let exactTag = "";
  let tagType = "";
  try {
    exactTag = run("git", ["describe", "--tags", "--exact-match", "HEAD"], {
      capture: true,
    });
    tagType = run("git", ["cat-file", "-t", `refs/tags/${exactTag}`], {
      capture: true,
    });
  } catch {
    // assertReleaseState returns the operator-facing refusal below.
  }
  return { porcelain, exactTag, tagType };
}

const initial = releaseState();
const tag = assertReleaseState({ ...initial, packageVersion: packageJson.version });
const sha = run("git", ["rev-parse", "HEAD"], { capture: true });
const flyDeployArgs = buildFlyDeployArgs({ app: flyApp, sha, version: packageJson.version });

console.log(`[deploy-guarded] Verifying ${tag} (${sha}) for ${flyApp || "<unset app>"}`);
run("npm", ["test"]);

assertReleaseState({ ...releaseState(), packageVersion: packageJson.version });
run(flyBin, flyDeployArgs);

const record = buildProvenanceRecord({ app: flyApp, tag, sha });
fs.mkdirSync(path.dirname(provenanceFile), { recursive: true });
fs.appendFileSync(provenanceFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
console.log(JSON.stringify(record, null, 2));
