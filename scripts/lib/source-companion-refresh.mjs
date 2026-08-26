import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { projectRefFromDatabaseUrl } from "./hosted-runtime-binding.mjs";

export { projectRefFromDatabaseUrl };

export function assertCompanionRefreshScope({
  brainId,
  actualProjectRef,
  expectedProjectRef,
  apply,
}) {
  if (!brainId || !String(brainId).trim()) {
    throw new Error("A Brain id is required");
  }
  if (expectedProjectRef && actualProjectRef !== expectedProjectRef) {
    throw new Error("Database URL does not match --expected-project-ref");
  }
  if (apply && !expectedProjectRef) {
    throw new Error("--expected-project-ref is required in apply mode");
  }
  return { brainId, actualProjectRef, expectedProjectRef };
}

export function sha256Bytes(content) {
  return createHash("sha256").update(content).digest("hex");
}

export async function loadMonitorProfile(configPath, brainId) {
  const raw = JSON.parse(await fs.readFile(path.resolve(configPath), "utf8"));
  const profiles = Array.isArray(raw.brains) ? raw.brains : [raw];
  const profile = profiles.find((candidate) => candidate?.brainId === brainId);
  if (!profile) {
    throw new Error(`Brain Monitor profile not found for ${brainId}`);
  }
  const env = profile.env || profile.syncProcess?.env || {};
  if (!env.BRAIN_REVISION_DATABASE_URL || !env.BRAIN_EXPECTED_SUPABASE_PROJECT_REF) {
    throw new Error(`Brain Monitor profile ${brainId} is missing its database binding`);
  }
  return {
    brainId,
    databaseUrl: env.BRAIN_REVISION_DATABASE_URL,
    expectedProjectRef: env.BRAIN_EXPECTED_SUPABASE_PROJECT_REF,
  };
}

function normalizedRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function assertCompanionPath(brainRoot, requestedPath) {
  const relativePath = normalizedRelativePath(requestedPath);
  if (
    !relativePath.startsWith("sources/") ||
    !relativePath.toLowerCase().endsWith(".md") ||
    relativePath.split("/").includes("..") ||
    path.posix.isAbsolute(relativePath)
  ) {
    throw new Error(`Invalid source companion path: ${requestedPath}`);
  }
  const root = path.resolve(brainRoot);
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Source companion escapes Brain root: ${requestedPath}`);
  }
  return { relativePath, absolutePath };
}

export async function inventoryCompanions(brainRoot, requestedPaths) {
  const seen = new Set();
  const inventory = [];
  for (const requestedPath of requestedPaths) {
    const resolved = assertCompanionPath(brainRoot, requestedPath);
    if (seen.has(resolved.relativePath)) continue;
    seen.add(resolved.relativePath);
    const body = await fs.readFile(resolved.absolutePath);
    inventory.push({
      ...resolved,
      byteSize: body.byteLength,
      contentSha256: sha256Bytes(body),
      content: body.toString("utf8"),
    });
  }
  return inventory;
}

export function planCompanionRefresh(inventory, registryRows) {
  const rowsByPath = new Map();
  for (const row of registryRows) {
    const relativePath = normalizedRelativePath(row.companion_path || row.external_id || "");
    if (!rowsByPath.has(relativePath)) rowsByPath.set(relativePath, row);
  }
  return inventory.map((local) => {
    const current = rowsByPath.get(local.relativePath) || null;
    if (!current) return { state: "unregistered", local, current: null };
    return {
      state:
        current.content_sha256 === local.contentSha256 && current.text_available !== false
          ? "unchanged"
          : "refresh_required",
      local,
      current,
    };
  });
}

export function addOriginalArtifactSection(content, links) {
  if (links.length === 0 || /^## Original artifact\s*$/m.test(content)) return content;
  const section = [
    "## Original artifact",
    "",
    ...links.map((link) => `- ${link}`),
    "",
  ].join("\n");
  const brainLinks = content.match(/^## Brain links\s*$/m);
  if (brainLinks?.index !== undefined) {
    return `${content.slice(0, brainLinks.index).replace(/\s*$/, "\n\n")}${section}\n${content.slice(brainLinks.index)}`;
  }
  return `${content.replace(/\s*$/, "\n\n")}${section}`;
}
