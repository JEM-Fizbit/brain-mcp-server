import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  auditSemanticDestinations,
  isStrictBrainSemanticContent,
} = await import(path.join(__dirname, "..", "dist", "semantic-destinations", "index.js"));

test("semantic audit distinguishes current, historical and unavailable destinations", () => {
  const result = auditSemanticDestinations({
    brainFiles: new Map([
      [
        "current.md",
        "> Entity page — current\n\n## Canonical destinations\n\n- **Official website:** [Example](https://example.com/)\n",
      ],
      [
        "historical.md",
        "> Entity page — historical\n\n## Canonical destinations\n\n- **Entity status:** Historical; no current standalone website.\n- **Historical evidence:** [Filing](https://example.org/filing)\n",
      ],
      [
        "private.md",
        "> Entity page — private\n\n## Canonical destinations\n\n- **Website status:** No verified public website as of 22 August 2026.\n",
      ],
    ]),
  });

  assert.deepEqual(
    result.entityHubs.map((item) => [item.source, item.status]),
    [
      ["brain/current.md", "current"],
      ["brain/historical.md", "historical"],
      ["brain/private.md", "no_verified_public_website"],
    ]
  );
  assert.deepEqual(result.missingCanonicalDestinationSections, []);
  assert.deepEqual(result.incompleteCanonicalDestinationSections, []);
});

test("semantic audit reports missing and incomplete entity contracts", () => {
  const result = auditSemanticDestinations({
    brainFiles: new Map([
      ["missing.md", "> Entity page — missing\n"],
      [
        "incomplete.md",
        "> Entity page — incomplete\n\n## Canonical destinations\n\n- Related: [Elsewhere](https://elsewhere.example/)\n",
      ],
    ]),
  });

  assert.deepEqual(result.missingCanonicalDestinationSections, ["brain/missing.md"]);
  assert.deepEqual(result.incompleteCanonicalDestinationSections, ["brain/incomplete.md"]);
});

test("semantic audit separates portable links, bare URLs and source-only domains", () => {
  const result = auditSemanticDestinations({
    brainFiles: new Map([
      [
        "topic.md",
        "[Portable](https://brain.example/path)\nBare https://bare.example/path.\n<https://autolink.example/>\n```\nhttps://example.invalid/in-a-fence\n```\n",
      ],
    ]),
    sourceFiles: new Map([
      ["research/source.md", "Source https://source-only.example/report\n"],
    ]),
  });

  assert.deepEqual(result.bareExternalUrls, [
    {
      source: "brain/topic.md",
      target: "https://bare.example/path",
      line: 2,
      scope: "brain",
    },
    {
      source: "sources/research/source.md",
      target: "https://source-only.example/report",
      line: 1,
      scope: "sources",
    },
  ]);
  assert.deepEqual(result.sourceOnlyDomains, ["source-only.example"]);
  assert.equal(isStrictBrainSemanticContent("brain/topic.md"), true);
  assert.equal(isStrictBrainSemanticContent("brain/LOG.md"), false);
  assert.equal(isStrictBrainSemanticContent("brain/archive/old.md"), false);
});
