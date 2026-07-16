export function assertReleaseState({ porcelain, exactTag, tagType, packageVersion }) {
  if (porcelain.trim()) {
    throw new Error("Guarded deploy refused: working tree is not clean.");
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

export function buildProvenanceRecord({ app, tag, sha, deployedAt = new Date() }) {
  return {
    app,
    tag,
    sha,
    deployed_at: deployedAt.toISOString(),
  };
}
