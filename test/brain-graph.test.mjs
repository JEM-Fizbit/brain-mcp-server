import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { analyzeBrainGraph } = await import(
  path.join(__dirname, "..", "dist", "services", "brain-graph.js")
);

test("graph reachability resolves the spec 013 edge grammar", () => {
  const files = new Map([
    [
      "00_loader.md",
      [
        "[[projects/README|Projects]]",
        "[Governance](governance/README.md#policy)",
        "`references/templates.md`",
        "`entities/`",
        "https://example.sharepoint.com/sites/brain/references/sharepoint.md",
      ].join("\n"),
    ],
    ["NOW.md", "[Current project](projects/detail.md)"],
    ["projects/README.md", "[Detail](detail.md)"],
    ["projects/detail.md", "# Detail"],
    ["governance/README.md", "# Governance"],
    ["references/templates.md", "# Templates"],
    ["entities/README.md", "# Entities"],
    ["references/sharepoint.md", "# SharePoint mapped"],
    ["cycle/a.md", "[[cycle/b]]"],
    ["cycle/b.md", "[[cycle/a]]"],
    ["archive/JOURNAL-2026-01.md", "# rotated"],
  ]);

  const result = analyzeBrainGraph(files, {
    sharepoint_url_mappings: [
      {
        url_prefix: "https://example.sharepoint.com/sites/brain/",
        brain_path_prefix: "",
      },
    ],
    exempt_globs: ["archive/JOURNAL-*.md"],
  });

  for (const filename of [
    "projects/README.md",
    "projects/detail.md",
    "governance/README.md",
    "references/templates.md",
    "entities/README.md",
    "references/sharepoint.md",
  ]) {
    assert.ok(result.reachable.includes(filename), `${filename} should be reachable`);
  }
  assert.deepEqual(result.unreachable, ["cycle/a.md", "cycle/b.md"]);
  assert.deepEqual(result.exempted, ["archive/JOURNAL-2026-01.md"]);
  assert.equal(result.diagnostics.length, 0);
});

test("graph reachability reports malformed, escaping, parent-disabled, and unresolved edges", () => {
  const result = analyzeBrainGraph(
    new Map([
      [
        "00_loader.md",
        [
          "[bad encoding](bad%ZZ.md)",
          "[escape](/tmp/private.md)",
          "[parent](../outside.md)",
          "`missing/`",
          "[[missing-file]]",
        ].join("\n"),
      ],
      ["NOW.md", "# now"],
    ]),
    { relative_parent_scope: "disabled" }
  );
  assert.deepEqual(
    new Set(result.diagnostics.map((diagnostic) => diagnostic.code)),
    new Set([
      "malformed_encoding",
      "path_escape",
      "parent_link_disabled",
      "missing_directory_index",
      "unresolved_target",
    ])
  );
});

test("directory references prefer README and Markdown links stay source-relative", () => {
  const result = analyzeBrainGraph(
    new Map([
      ["00_loader.md", "`hub/`\n[Section](section/README.md)"],
      ["NOW.md", "# now"],
      ["hub/README.md", "# preferred"],
      ["hub/INDEX.md", "# fallback only"],
      ["section/README.md", "[Child](child.md)"],
      ["section/child.md", "# source-relative child"],
      ["child.md", "# root collision must not win"],
    ])
  );

  assert.ok(result.reachable.includes("hub/README.md"));
  assert.ok(!result.reachable.includes("hub/INDEX.md"));
  assert.ok(result.reachable.includes("section/child.md"));
  assert.ok(!result.reachable.includes("child.md"));
  assert.equal(result.diagnostics.length, 0);
});
