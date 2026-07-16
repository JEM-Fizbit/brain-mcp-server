import assert from "node:assert/strict";
import test from "node:test";

import {
  IngestCompleteSchema,
  IngestSchema,
  ListSourcesSchema,
} from "../dist/schemas/tools.js";

test("source tools accept deployment-specific categories", () => {
  assert.equal(ListSourcesSchema.parse({ category: "legal" }).category, "legal");
  assert.equal(
    IngestSchema.parse({ source_label: "Template", category: "templates" }).category,
    "templates"
  );
  assert.equal(
    IngestCompleteSchema.parse({
      source_label: "Brand pack",
      category: "brand",
      md_file: "sources/brand/pack.md",
      files_touched: [],
    }).category,
    "brand"
  );
});
