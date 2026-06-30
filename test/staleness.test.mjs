import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { getStalenessThreshold } = await import(
  path.join(__dirname, "..", "dist", "services", "brain.js")
);
const { STALENESS } = await import(
  path.join(__dirname, "..", "dist", "constants.js")
);

test("staleness tiers are matched by semantic name, not number prefix", () => {
  // NOW.md handled by exact name (universal across Brains)
  assert.equal(getStalenessThreshold("NOW.md"), STALENESS.NOW);

  // ACTIVE tier — found by name regardless of the number prefix
  assert.equal(
    getStalenessThreshold("05_projects.md"),
    STALENESS.ACTIVE,
    "JEM's 05_projects.md must be ACTIVE (was DEFAULT under the number scheme)"
  );
  assert.equal(
    getStalenessThreshold("03_projects.md"),
    STALENESS.ACTIVE,
    "canonical 03_projects.md must also be ACTIVE"
  );
  assert.equal(
    getStalenessThreshold("04_active_roles.md"),
    STALENESS.ACTIVE,
    "active_roles must be ACTIVE (was IDENTITY under the number scheme)"
  );

  // IDENTITY tier
  assert.equal(getStalenessThreshold("01_identity.md"), STALENESS.IDENTITY);

  // DEFAULT — files the old /^02_/ /^03_/ number scheme mis-tiered as ACTIVE
  assert.equal(getStalenessThreshold("02_expertise.md"), STALENESS.DEFAULT);
  assert.equal(getStalenessThreshold("03_work_style.md"), STALENESS.DEFAULT);

  // Entity hubs and reference files — DEFAULT
  assert.equal(getStalenessThreshold("quanta.md"), STALENESS.DEFAULT);
  assert.equal(getStalenessThreshold("ref_capital_deals.md"), STALENESS.DEFAULT);
});
