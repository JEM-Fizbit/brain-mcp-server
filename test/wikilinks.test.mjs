import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { rewriteInboundLinks, findInboundLinkFiles } = await import(
  path.join(__dirname, "..", "dist", "services", "wikilinks.js")
);

const files = (obj) => Object.entries(obj).map(([name, content]) => ({ name, content }));

test("rewrites a bare [[old]] link when the basename is unique", () => {
  const fs = files({ "a.md": "see [[old]] here", "old.md": "x" });
  const { updates, ambiguous } = rewriteInboundLinks(fs, "old.md", "new.md");
  assert.equal(ambiguous, false);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].name, "a.md");
  assert.equal(updates[0].content, "see [[new]] here");
});

test("preserves a plain |alias", () => {
  const fs = files({ "a.md": "[[old|Display Name]]", "old.md": "x" });
  const { updates } = rewriteInboundLinks(fs, "old.md", "new.md");
  assert.equal(updates[0].content, "[[new|Display Name]]");
});

test("preserves an escaped \\| alias (markdown table form)", () => {
  const fs = files({ "a.md": "| [[old\\|Alias]] |", "old.md": "x" });
  const { updates } = rewriteInboundLinks(fs, "old.md", "new.md");
  assert.equal(updates[0].content, "| [[new\\|Alias]] |");
});

test("preserves a #heading anchor", () => {
  const fs = files({ "a.md": "[[old#Section]]", "old.md": "x" });
  const { updates } = rewriteInboundLinks(fs, "old.md", "new.md");
  assert.equal(updates[0].content, "[[new#Section]]");
});

test("does not touch links to other files", () => {
  const fs = files({ "a.md": "[[other]] and [[oldish]]", "old.md": "x" });
  const { updates } = rewriteInboundLinks(fs, "old.md", "new.md");
  assert.equal(updates.length, 0);
});

test("collision: a bare basename shared by two files is NOT rewritten, and is flagged ambiguous", () => {
  const fs = files({
    "a.md": "[[old]]",
    "old.md": "x",
    "sub/old.md": "y",
  });
  const { updates, ambiguous } = rewriteInboundLinks(fs, "old.md", "new.md");
  assert.equal(ambiguous, true, "collision flagged");
  assert.equal(updates.length, 0, "bare [[old]] left untouched to avoid mis-pointing");
});

test("rewrites a path-qualified [[sub/old]] link exactly", () => {
  const fs = files({ "a.md": "[[sub/old]]", "sub/old.md": "x", "old.md": "z" });
  const { updates } = rewriteInboundLinks(fs, "sub/old.md", "sub/new.md");
  assert.equal(updates[0].content, "[[sub/new]]");
});

test("rewrites multiple links in one file and across files", () => {
  const fs = files({
    "a.md": "[[old]] then [[old|Alias]] again",
    "b.md": "also [[old]]",
    "old.md": "x",
  });
  const { updates } = rewriteInboundLinks(fs, "old.md", "new.md");
  const byName = Object.fromEntries(updates.map((u) => [u.name, u.content]));
  assert.equal(byName["a.md"], "[[new]] then [[new|Alias]] again");
  assert.equal(byName["b.md"], "also [[new]]");
});

test("findInboundLinkFiles lists files linking to a target (unique basename)", () => {
  const fs = files({
    "a.md": "[[old]]",
    "b.md": "[[old|x]]",
    "c.md": "nothing",
    "old.md": "x",
  });
  const linkers = findInboundLinkFiles(fs, "old.md");
  assert.deepEqual(linkers.sort(), ["a.md", "b.md"]);
});
