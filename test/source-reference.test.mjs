import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  auditSourceLinks,
  compileSourceReference,
  extractEmbeddedSourceReference,
  SourceReferenceManifestSchema,
} = await import(path.join(__dirname, "..", "dist", "source-references", "index.js"));
const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_ID = "22222222-2222-4222-8222-222222222222";

function manifest(overrides = {}) {
  return {
    schema: "brain.source-reference/v1",
    brainId: "ai-brain-jem",
    sourceId: SOURCE_ID,
    label: "Radiology AI working context",
    category: "research",
    status: "processed",
    evidenceTier: "secondary",
    provenanceNote: "Reviewed working context compiled from secondary coverage.",
    evidenceLimitation: "The primary panel transcript was not accessed.",
    companionPath: "sources/research/2026-04-10_radiology-ai-context.md",
    sourceUrls: [
      { label: "Trade press coverage", url: "https://example.com/radiology" },
    ],
    artifacts: [
      {
        id: ARTIFACT_ID,
        kind: "original",
        label: "Dropbox working context",
        provider: "dropbox",
        providerId: "id:fixture-example",
        providerRevision: "fixture-revision-1",
        webUrl: "https://www.dropbox.com/scl/fi/example",
        rootAlias: "dropbox_personal",
        relativePath: "Personal/Substack/AI vs Radiologists/context.md",
        contentSha256: "a".repeat(64),
        mimeType: "text/markdown",
        byteSize: 20107,
        observedAt: "2026-08-22T11:30:00.000Z",
      },
    ],
    brainLinks: [
      {
        filename: "10_mental_models.md",
        relation: "context",
        label: "AI and clinical evidence",
      },
    ],
    summary: "The note preserves claims, provenance and the primary-evidence gap.",
    contentMarkdown: "## Finding\n\nSecondary reporting is not primary evidence.",
    ...overrides,
  };
}

test("source-reference compiler is deterministic and emits portable links plus a receipt", () => {
  const first = compileSourceReference(manifest());
  const second = compileSourceReference(manifest());

  assert.equal(first.markdown, second.markdown);
  assert.equal(first.receipt.contentSha256, second.receipt.contentSha256);
  assert.match(first.markdown, /\[AI and clinical evidence\]\(\.\.\/\.\.\/brain\/10_mental_models\.md\)/);
  assert.match(first.markdown, /\[Open in dropbox\]\(https:\/\/www\.dropbox\.com\/scl\/fi\/example\)/);
  assert.match(first.markdown, /Provider file ID: `id:fixture-example`/);
  assert.doesNotMatch(first.markdown, /\/Users\/johnemilad/);
  assert.deepEqual(first.receipt.brainFiles, ["10_mental_models.md"]);

  const embedded = extractEmbeddedSourceReference(first.markdown);
  assert.equal(embedded.sourceId, SOURCE_ID);
  assert.equal(embedded.contentMarkdown, "");
});

test("source-reference schema rejects unsafe paths, non-HTTPS URLs and incomplete locators", () => {
  assert.throws(() =>
    SourceReferenceManifestSchema.parse(
      manifest({ companionPath: "../outside.md" })
    )
  );
  assert.throws(() =>
    SourceReferenceManifestSchema.parse(
      manifest({
        artifacts: [
          {
            id: ARTIFACT_ID,
            kind: "original",
            label: "bad",
            webUrl: "http://example.com/source",
          },
        ],
      })
    )
  );
  assert.throws(() =>
    SourceReferenceManifestSchema.parse(
      manifest({
        artifacts: [{ id: ARTIFACT_ID, kind: "original", label: "missing locator" }],
      })
    )
  );
  assert.throws(() => compileSourceReference(manifest({ provenanceNote: "bad --> marker" })));
  assert.throws(() =>
    SourceReferenceManifestSchema.parse(
      manifest({ artifacts: [manifest().artifacts[0], manifest().artifacts[0]] })
    )
  );
});

test("source-link audit distinguishes direct, index-only, unlinked and non-clickable references", () => {
  const result = auditSourceLinks({
    brainFiles: new Map([
      ["topic.md", "[Direct](../sources/research/direct.md) and `sources/research/code-only.md`"],
      ["SOURCES.md", "[Indexed](../sources/research/index-only.md)"],
      ["broken.md", "[Bad](sources/research/direct.md)"],
    ]),
    sourceFiles: new Map([
      ["research/direct.md", "[Back](../../brain/topic.md)"],
      ["research/index-only.md", "Existing Obsidian backlink: [[topic]]"],
      ["research/unlinked.md", "No backlink"],
      ["research/code-only.md", "No backlink"],
    ]),
  });

  assert.deepEqual(result.directlyLinkedCompanions, ["sources/research/direct.md"]);
  assert.deepEqual(result.indexOnlyCompanions, ["sources/research/index-only.md"]);
  assert.deepEqual(result.unlinkedCompanions, [
    "sources/research/code-only.md",
    "sources/research/unlinked.md",
  ]);
  assert.deepEqual(result.companionsWithoutBacklinks, [
    "sources/research/code-only.md",
    "sources/research/unlinked.md",
  ]);
  assert.equal(result.nonClickableSourceReferences.length, 1);
  assert.equal(
    result.nonClickableSourceReferences[0].suggestion,
    "[code only](../sources/research/code-only.md)"
  );
  assert.deepEqual(result.brokenLinks, [
    {
      source: "brain/broken.md",
      target: "sources/research/direct.md",
      suggestion: "../sources/research/direct.md",
    },
  ]);
});

test("source-link audit excludes source folder indexes from evidence-companion counts", () => {
  const result = auditSourceLinks({
    brainFiles: new Map([["topic.md", "[Source](../sources/company/source.md)"]]),
    sourceFiles: new Map([
      ["README.md", "# Source archive"],
      ["company/README.md", "# Company sources"],
      ["company/INDEX.md", "# Company index"],
      ["company/source.md", "[Back](../../brain/topic.md)"],
    ]),
  });

  assert.equal(result.sourceCompanions, 1);
  assert.deepEqual(result.directlyLinkedCompanions, ["sources/company/source.md"]);
  assert.deepEqual(result.unlinkedCompanions, []);
  assert.deepEqual(result.companionsWithoutBacklinks, []);
});

test("source-link audit requires clickable primary declarations and original artifacts", () => {
  const result = auditSourceLinks({
    brainFiles: new Map([
      ["reference.md", "> **Sources:** CV (FINAL), Resume (FINAL)\n\n[CV](../sources/cv/profile.md)"],
    ]),
    sourceFiles: new Map([
      ["cv/profile.md", "# Profile\n\n[Back](../../brain/reference.md)\n"],
      ["assessments/report.md", "# Report\n\n[Original](./report.pdf)\n[Back](../../brain/reference.md)\n"],
    ]),
    sourceArtifactFiles: new Set([
      "cv/profile.md",
      "cv/profile.pdf",
      "assessments/report.md",
      "assessments/report.pdf",
    ]),
  });

  assert.deepEqual(result.nonClickablePrimarySourceDeclarations, [
    {
      source: "brain/reference.md",
      target: "CV (FINAL), Resume (FINAL)",
      suggestion:
        "Replace each named source with a direct Markdown link to its reviewed companion.",
    },
  ]);
  assert.deepEqual(result.companionsWithoutOriginalLinks, [
    {
      source: "sources/cv/profile.md",
      target: "sources/cv/profile.pdf",
      suggestion: "[Open original PDF](./profile.pdf)",
    },
  ]);
});
