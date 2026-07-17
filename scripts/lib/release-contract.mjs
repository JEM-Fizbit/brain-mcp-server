const OVERLAY_CONFIG_PATH = /^config\/[a-z0-9][a-z0-9._-]*\.json$/;
const OVERLAY_DOC_PATH = /^docs\/.+\.md$/;

function assertOverlayChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("Guarded deploy refused: overlay has no committed changes.");
  }

  for (const change of changes) {
    if (!change || !["A", "M"].includes(change.status)) {
      throw new Error(
        `Guarded deploy refused: overlay change status ${change?.status || "<missing>"} is not allowed.`
      );
    }
    const allowed =
      change.path === "fly.toml" ||
      change.path === "test/deploy-expectations.json" ||
      OVERLAY_CONFIG_PATH.test(change.path) ||
      OVERLAY_DOC_PATH.test(change.path);
    if (!allowed) {
      throw new Error(`Guarded deploy refused: overlay path is not allowed: ${change.path}`);
    }
  }

  const paths = new Set(changes.map((change) => change.path));
  if (!paths.has("fly.toml")) {
    throw new Error("Guarded deploy refused: overlay must include fly.toml.");
  }
  if (!paths.has("test/deploy-expectations.json")) {
    throw new Error(
      "Guarded deploy refused: overlay must include test/deploy-expectations.json."
    );
  }
  if (![...paths].some((filePath) => OVERLAY_CONFIG_PATH.test(filePath))) {
    throw new Error("Guarded deploy refused: overlay must include a config/*.json registry.");
  }
  if (![...paths].some((filePath) => OVERLAY_DOC_PATH.test(filePath))) {
    throw new Error("Guarded deploy refused: overlay must include a docs/*.md runbook.");
  }
}

export function assertReleaseState({
  porcelain,
  exactTag,
  tagType,
  packageVersion,
  overlay,
}) {
  if (porcelain.trim()) {
    throw new Error("Guarded deploy refused: working tree is not clean.");
  }
  if (overlay) {
    if (overlay.upstreamTagType !== "tag") {
      throw new Error("Guarded deploy refused: the upstream release ref is not an annotated tag.");
    }
    if (overlay.upstreamTag !== `v${packageVersion}`) {
      throw new Error(
        `Guarded deploy refused: upstream tag ${overlay.upstreamTag} does not match package version ${packageVersion}.`
      );
    }
    if (!overlay.upstreamIsAncestor) {
      throw new Error("Guarded deploy refused: upstream tag is not an ancestor of overlay HEAD.");
    }
    assertOverlayChanges(overlay.changes);
    return overlay.upstreamTag;
  }
  if (!exactTag) {
    throw new Error("Guarded deploy refused: HEAD is not at an exact tag.");
  }
  if (tagType !== "tag") {
    throw new Error("Guarded deploy refused: the exact release ref is not an annotated tag.");
  }
  if (exactTag !== `v${packageVersion}`) {
    throw new Error(
      `Guarded deploy refused: exact tag ${exactTag} does not match package version ${packageVersion}.`
    );
  }
  return exactTag;
}

export function buildFlyDeployArgs({ app, sha, version }) {
  if (!app?.trim()) throw new Error("BRAIN_FLY_APP is required for guarded deploy.");
  return [
    "deploy",
    "--app",
    app.trim(),
    "--build-arg",
    `GIT_SHA=${sha}`,
    "--build-arg",
    `APP_VERSION=${version}`,
  ];
}

const TEST_ENV_PREFIXES = [
  "BRAIN_",
  "MCP_",
  "GITHUB_ALLOWED_",
  "GITHUB_OAUTH_",
  "SUPABASE_",
];

export function buildReleaseTestEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => !TEST_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
    )
  );
}

export function buildProvenanceRecord({
  app,
  tag,
  sha,
  upstreamSha,
  overlaySha,
  deployedAt = new Date(),
}) {
  const record = {
    app,
    tag,
    sha,
  };
  if (upstreamSha) record.upstream_sha = upstreamSha;
  if (overlaySha) record.overlay_sha = overlaySha;
  record.deployed_at = deployedAt.toISOString();
  return record;
}
