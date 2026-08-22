import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const RELATIONS = new Map([
  ["evidence", "supports"],
  ["context", "context"],
  ["mentions", "mentions"],
  ["contradicts", "contradicts"],
  ["derived_from", "derived_from"],
]);

function posixRelative(root, filename) {
  return path.relative(root, filename).split(path.sep).join("/");
}

export function parseDeclaredBrainLinks(companionPath, content) {
  const lines = content.split("\n");
  const links = [];
  let inSection = false;

  for (const line of lines) {
    if (line === "## Brain links") {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (!inSection || !line.startsWith("- [")) continue;

    const match = line.match(
      /^- \[([^\]]+)\]\((?:<([^>]+)>|([^\s)]+))\)\s+—\s+(evidence|context|mentions|contradicts|derived_from)\s*$/
    );
    if (!match) {
      throw new Error(`Invalid declared Brain link in ${companionPath}: ${line}`);
    }
    const target = decodeURIComponent(match[2] || match[3]);
    const [targetPath, anchor = ""] = target.split("#", 2);
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(companionPath), targetPath)
    );
    if (!resolved.startsWith("brain/") || !resolved.endsWith(".md")) {
      throw new Error(`Declared Brain link escapes the Brain Markdown root: ${target}`);
    }
    links.push({
      brainFilename: resolved.slice("brain/".length),
      label: match[1],
      relation: RELATIONS.get(match[4]),
      anchor,
    });
  }

  if (!inSection) {
    throw new Error(`Source companion is missing a ## Brain links section: ${companionPath}`);
  }
  if (links.length === 0) {
    throw new Error(`Source companion has no declared Brain links: ${companionPath}`);
  }
  return links;
}

export async function collectSourceBrainLinkDeclarations(brainRoot) {
  const sourceRoot = path.join(brainRoot, "sources");
  const brainDir = path.join(brainRoot, "brain");
  const declarations = [];

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const companionPath = `sources/${posixRelative(sourceRoot, fullPath)}`;
      const content = await fs.readFile(fullPath, "utf-8");
      const links = parseDeclaredBrainLinks(companionPath, content);
      for (const link of links) {
        await fs.access(path.join(brainDir, link.brainFilename));
      }
      declarations.push({
        companionPath,
        links,
        byteSize: Buffer.byteLength(content, "utf-8"),
        contentSha256: createHash("sha256").update(content).digest("hex"),
      });
    }
  }

  await walk(sourceRoot);
  return declarations;
}
