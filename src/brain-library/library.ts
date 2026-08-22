import fs from "node:fs/promises";
import path from "node:path";
import MarkdownIt from "markdown-it";
import {
  extractEmbeddedSourceReference,
  type SourceReferenceManifest,
} from "../source-references/index.js";
import type { ArtifactRegistration } from "./resolver.js";

export interface LibraryFile {
  repoPath: string;
  title: string;
  kind: "brain" | "source";
  markdown: string;
  manifest: SourceReferenceManifest | null;
}

export interface LibrarySnapshot {
  brainRoot: string;
  files: LibraryFile[];
  artifacts: Map<string, ArtifactRegistration>;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isSafeLibraryMarkdownPath(value: string): boolean {
  if (!value.endsWith(".md") || value.includes("\\") || path.posix.isAbsolute(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.split("/").includes("..")) return false;
  return normalized.startsWith("brain/") || normalized.startsWith("sources/");
}

function titleFor(markdown: string, repoPath: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || path.posix.basename(repoPath, ".md").replace(/[-_]+/g, " ");
}

async function walkMarkdown(root: string, prefix: "brain" | "sources"): Promise<LibraryFile[]> {
  const base = path.join(root, prefix);
  const files: LibraryFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(candidate);
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const repoPath = path.relative(root, candidate).split(path.sep).join("/");
      const markdown = await fs.readFile(candidate, "utf-8");
      let manifest: SourceReferenceManifest | null = null;
      if (prefix === "sources") {
        try {
          manifest = extractEmbeddedSourceReference(markdown);
        } catch {
          manifest = null;
        }
      }
      files.push({
        repoPath,
        title: titleFor(markdown, repoPath),
        kind: prefix === "brain" ? "brain" : "source",
        markdown,
        manifest,
      });
    }
  }
  await walk(base);
  return files;
}

export async function loadLibrarySnapshot(brainRoot: string): Promise<LibrarySnapshot> {
  const canonicalRoot = await fs.realpath(brainRoot);
  const [brainFiles, sourceFiles] = await Promise.all([
    walkMarkdown(canonicalRoot, "brain"),
    walkMarkdown(canonicalRoot, "sources"),
  ]);
  const files = [...brainFiles, ...sourceFiles];
  const artifacts = new Map<string, ArtifactRegistration>();
  for (const file of sourceFiles) {
    if (!file.manifest) continue;
    for (const artifact of file.manifest.artifacts) {
      if (artifacts.has(artifact.id)) {
        throw new Error(`Duplicate source artifact id: ${artifact.id}`);
      }
      artifacts.set(artifact.id, { sourceId: file.manifest.sourceId, artifact });
    }
  }
  return { brainRoot: canonicalRoot, files, artifacts };
}

export async function readLibraryFile(
  snapshot: LibrarySnapshot,
  repoPath: string
): Promise<LibraryFile> {
  if (!isSafeLibraryMarkdownPath(repoPath)) throw new Error("Unsafe Library path");
  const candidate = path.resolve(snapshot.brainRoot, repoPath);
  if (!isWithin(snapshot.brainRoot, candidate)) throw new Error("Library path escapes root");
  const canonical = await fs.realpath(candidate);
  if (!isWithin(snapshot.brainRoot, canonical)) throw new Error("Library symlink escapes root");
  const indexed = snapshot.files.find((file) => file.repoPath === repoPath);
  if (!indexed) throw new Error("Library Markdown file not found");
  return indexed;
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\[\]\\])/g, "\\$1");
}

function wikiLinks(markdown: string): string {
  return markdown.replace(
    /(!?)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
    (_whole, embed: string, rawTarget: string, rawAnchor: string, rawLabel: string) => {
      const target = String(rawTarget).trim().replace(/\.md$/i, "");
      if (!target || target.includes("..") || target.startsWith("/")) return _whole;
      const repoTarget = `brain/${target}.md`;
      const label = escapeMarkdownLabel(String(rawLabel || target).trim());
      const anchor = rawAnchor ? `#${encodeURIComponent(String(rawAnchor).trim())}` : "";
      const href = `/view?file=${encodeURIComponent(repoTarget)}${anchor}`;
      return `${embed ? "Attachment: " : ""}[${label}](${href})`;
    }
  );
}

function externalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function renderMarkdown(markdown: string, repoPath: string): string {
  const renderer = new MarkdownIt({ html: false, linkify: true, typographer: true });
  const defaultLinkOpen =
    renderer.renderer.rules.link_open ||
    ((tokens, index, options, _environment, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
    const token = tokens[index];
    const hrefIndex = token.attrIndex("href");
    if (hrefIndex >= 0) {
      const original = token.attrs?.[hrefIndex]?.[1] || "";
      if (externalHttpUrl(original)) {
        token.attrSet("target", "_blank");
        token.attrSet("rel", "noopener noreferrer");
      } else if (original.startsWith("/view?file=")) {
        token.attrSet("data-library-link", "true");
      } else if (!original.startsWith("#")) {
        const [targetPart, suffix = ""] = original.split(/(?=[?#])/u, 2);
        let target = path.posix.normalize(
          path.posix.join(path.posix.dirname(repoPath), decodeURIComponent(targetPart))
        );
        if (!target.endsWith(".md")) {
          token.attrSet("href", "#artifact-link-unavailable");
          token.attrSet("aria-disabled", "true");
          token.attrSet("title", "Use the registered artifact action in the source details panel");
        } else if (isSafeLibraryMarkdownPath(target)) {
          token.attrSet("href", `/view?file=${encodeURIComponent(target)}${suffix}`);
          token.attrSet("data-library-link", "true");
        }
      }
    }
    return defaultLinkOpen(tokens, index, options, environment, self);
  };
  const withoutMachineManifest = markdown.replace(
    /<!--\s*brain\.source-reference\/v1[\s\S]*?-->/g,
    ""
  );
  return renderer.render(wikiLinks(withoutMachineManifest));
}
