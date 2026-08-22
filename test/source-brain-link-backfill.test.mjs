import assert from "node:assert/strict";
import test from "node:test";
import { parseDeclaredBrainLinks } from "../scripts/lib/source-brain-link-backfill.mjs";

test("parseDeclaredBrainLinks returns reviewed relation declarations", () => {
  const links = parseDeclaredBrainLinks(
    "sources/research/example.md",
    [
      "# Example",
      "",
      "## Brain links",
      "",
      "- [Learning](../../brain/07_interests_learning.md) — context",
      "- [Claims](../../brain/ref_claims.md) — evidence",
      "",
      "## Source URLs",
    ].join("\n")
  );
  assert.deepEqual(links, [
    {
      brainFilename: "07_interests_learning.md",
      label: "Learning",
      relation: "context",
      anchor: "",
    },
    {
      brainFilename: "ref_claims.md",
      label: "Claims",
      relation: "supports",
      anchor: "",
    },
  ]);
});

test("parseDeclaredBrainLinks rejects missing, empty, or escaping declarations", () => {
  assert.throws(
    () => parseDeclaredBrainLinks("sources/research/example.md", "# Example\n"),
    /missing a ## Brain links section/
  );
  assert.throws(
    () =>
      parseDeclaredBrainLinks(
        "sources/research/example.md",
        "# Example\n\n## Brain links\n"
      ),
    /has no declared Brain links/
  );
  assert.throws(
    () =>
      parseDeclaredBrainLinks(
        "sources/research/example.md",
        "## Brain links\n\n- [Escape](../../../outside.md) — context\n"
      ),
    /escapes the Brain Markdown root/
  );
});
