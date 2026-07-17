import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "./lib/load-local-env.mjs";
import {
  assertReleaseState,
  buildFlyDeployArgs,
  buildProvenanceRecord,
  buildReleaseTestEnv,
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
    env: options.env || process.env,
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
  const upstreamTag = process.env.BRAIN_DEPLOY_UPSTREAM_TAG?.trim();
  if (!upstreamTag) return { porcelain, exactTag, tagType };

  let upstreamTagType = "";
  let upstreamSha = "";
  let upstreamIsAncestor = false;
  let changes = [];
  try {
    const upstreamRef = `refs/tags/${upstreamTag}`;
    upstreamTagType = run("git", ["cat-file", "-t", upstreamRef], { capture: true });
    upstreamSha = run("git", ["rev-parse", `${upstreamRef}^{}`], { capture: true });
    run("git", ["merge-base", "--is-ancestor", upstreamRef, "HEAD"], { capture: true });
    upstreamIsAncestor = true;
    const changeOutput = run(
      "git",
      ["diff", "--name-status", "--no-renames", `${upstreamRef}..HEAD`],
      { capture: true }
    );
    changes = changeOutput
      ? changeOutput.split("\n").map((line) => {
          const [status, ...pathParts] = line.split("\t");
          return { status, path: pathParts.join("\t") };
        })
      : [];
  } catch {
    // assertReleaseState returns the operator-facing refusal below.
  }
  return {
    porcelain,
    exactTag,
    tagType,
    overlay: {
      upstreamTag,
      upstreamTagType,
      upstreamSha,
      upstreamIsAncestor,
      changes,
    },
  };
}

const initial = releaseState();
const tag = assertReleaseState({ ...initial, packageVersion: packageJson.version });
const sha = run("git", ["rev-parse", "HEAD"], { capture: true });
const flyDeployArgs = buildFlyDeployArgs({ app: flyApp, sha, version: packageJson.version });

const releaseDescription = initial.overlay
  ? `${tag} (${initial.overlay.upstreamSha}) + overlay ${sha}`
  : `${tag} (${sha})`;
console.log(`[deploy-guarded] Verifying ${releaseDescription} for ${flyApp || "<unset app>"}`);
run("npm", ["test"], { env: buildReleaseTestEnv(process.env) });

assertReleaseState({ ...releaseState(), packageVersion: packageJson.version });
run(flyBin, flyDeployArgs);

const record = buildProvenanceRecord({
  app: flyApp,
  tag,
  sha,
  upstreamSha: initial.overlay?.upstreamSha,
  overlaySha: initial.overlay ? sha : undefined,
});
fs.mkdirSync(path.dirname(provenanceFile), { recursive: true });
fs.appendFileSync(provenanceFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
console.log(JSON.stringify(record, null, 2));
