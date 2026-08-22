import { createHash } from "node:crypto";
import path from "node:path";
import {
  SOURCE_REFERENCE_SCHEMA,
  SourceReferenceManifestSchema,
  type SourceReferenceArtifact,
  type SourceReferenceManifest,
} from "./schema.js";

export interface SourceCompilationReceipt {
  schema: "brain.source-compilation-receipt/v1";
  brainId: string;
  sourceId: string;
  companionPath: string;
  contentSha256: string;
  artifactIds: string[];
  brainFiles: string[];
}

export interface CompiledSourceReference {
  manifest: SourceReferenceManifest;
  markdown: string;
  receipt: SourceCompilationReceipt;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function markdownLabel(value: string): string {
  return value.replace(/([\[\]\\])/g, "\\$1");
}

function markdownCode(value: string): string {
  return value.includes("`") ? `\`\`${value}\`\`` : `\`${value}\``;
}

function encodeRelativeTarget(value: string): string {
  return value
    .split("/")
    .map((segment) => (segment === "." || segment === ".." ? segment : encodeURIComponent(segment)))
    .join("/");
}

function relativeLink(fromPath: string, toPath: string, anchor?: string): string {
  let relative = path.posix.relative(path.posix.dirname(fromPath), toPath);
  if (!relative.startsWith(".")) relative = `./${relative}`;
  const encoded = encodeRelativeTarget(relative);
  return anchor ? `${encoded}#${encodeURIComponent(anchor)}` : encoded;
}

function artifactActions(
  manifest: SourceReferenceManifest,
  artifact: SourceReferenceArtifact
): string[] {
  const actions: string[] = [];
  if (artifact.rootAlias === "brain_repo" && artifact.relativePath) {
    actions.push(
      `[Open local artifact](${relativeLink(manifest.companionPath, artifact.relativePath)})`
    );
  }
  if (artifact.webUrl) {
    actions.push(`[Open in ${markdownLabel(artifact.provider || "browser")}](${artifact.webUrl})`);
  }
  return actions;
}

function embeddedManifest(manifest: SourceReferenceManifest): string {
  const { contentMarkdown: _contentMarkdown, ...identity } = manifest;
  const serialized = JSON.stringify(identity, null, 2);
  if (serialized.includes("-->")) {
    throw new Error("Source-reference identity fields may not contain an HTML comment terminator");
  }
  return [
    `<!-- ${SOURCE_REFERENCE_SCHEMA}`,
    serialized,
    "-->",
  ].join("\n");
}

export function extractEmbeddedSourceReference(markdown: string): SourceReferenceManifest {
  const marker = `<!-- ${SOURCE_REFERENCE_SCHEMA}`;
  const start = markdown.indexOf(marker);
  if (start === -1) throw new Error("Source companion has no embedded source-reference manifest");
  const jsonStart = markdown.indexOf("\n", start);
  const end = markdown.indexOf("-->", jsonStart + 1);
  if (jsonStart === -1 || end === -1) {
    throw new Error("Source companion has an unterminated source-reference manifest");
  }
  const parsed = JSON.parse(markdown.slice(jsonStart + 1, end).trim());
  return SourceReferenceManifestSchema.parse({ ...parsed, contentMarkdown: "" });
}

export function compileSourceReference(input: unknown): CompiledSourceReference {
  const manifest = SourceReferenceManifestSchema.parse(input);
  const lines: string[] = [
    `# ${manifest.label}`,
    "",
    `> **Evidence tier:** ${manifest.evidenceTier.replace(/_/g, " ")}  `,
    `> **Status:** ${manifest.status}  `,
    `> **Provenance:** ${manifest.provenanceNote}`,
  ];

  if (manifest.evidenceLimitation) {
    lines.push(`> **Limitation:** ${manifest.evidenceLimitation}`);
  }

  if (manifest.summary) {
    lines.push("", manifest.summary);
  }

  lines.push("", "## Brain links", "");
  for (const link of manifest.brainLinks) {
    const target = relativeLink(
      manifest.companionPath,
      `brain/${link.filename}`,
      link.anchor
    );
    const label = link.label || link.filename.replace(/\.md$/, "");
    lines.push(`- [${markdownLabel(label)}](${target}) — ${link.relation.replace(/_/g, " ")}`);
  }

  if (manifest.sourceUrls.length > 0) {
    lines.push("", "## Source URLs", "");
    for (const source of manifest.sourceUrls) {
      lines.push(`- [${markdownLabel(source.label)}](${source.url})`);
    }
  }

  lines.push("", "## Artifacts", "");
  for (const artifact of manifest.artifacts) {
    lines.push(`### ${artifact.label}`, "");
    const actions = artifactActions(manifest, artifact);
    if (actions.length > 0) lines.push(actions.join(" · "), "");
    lines.push(`- Artifact ID: ${markdownCode(artifact.id)}`);
    if (artifact.provider) lines.push(`- Provider: ${markdownCode(artifact.provider)}`);
    if (artifact.providerId) lines.push(`- Provider file ID: ${markdownCode(artifact.providerId)}`);
    if (artifact.providerRevision) lines.push(`- Provider revision: ${markdownCode(artifact.providerRevision)}`);
    if (artifact.rootAlias) lines.push(`- Local root alias: ${markdownCode(artifact.rootAlias)}`);
    if (artifact.relativePath) lines.push(`- Root-relative path: ${markdownCode(artifact.relativePath)}`);
    if (artifact.contentSha256) lines.push(`- SHA-256: ${markdownCode(artifact.contentSha256)}`);
    if (artifact.mimeType) lines.push(`- Media type: ${markdownCode(artifact.mimeType)}`);
    if (artifact.byteSize !== undefined) lines.push(`- Bytes: ${artifact.byteSize}`);
    if (artifact.observedAt) lines.push(`- Observed: ${artifact.observedAt}`);
    lines.push("");
  }

  if (manifest.contentMarkdown.trim()) {
    lines.push("## Reviewed content", "", manifest.contentMarkdown.trim(), "");
  }

  lines.push(embeddedManifest(manifest), "");
  const markdown = lines.join("\n");
  return {
    manifest,
    markdown,
    receipt: {
      schema: "brain.source-compilation-receipt/v1",
      brainId: manifest.brainId,
      sourceId: manifest.sourceId,
      companionPath: manifest.companionPath,
      contentSha256: sha256(markdown),
      artifactIds: manifest.artifacts.map((artifact) => artifact.id),
      brainFiles: manifest.brainLinks.map((link) => link.filename),
    },
  };
}
