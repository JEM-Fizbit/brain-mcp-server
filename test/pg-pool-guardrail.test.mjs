import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "..", "src");

async function collectTsFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

test("every pg Pool construction site attaches an error logger", async () => {
  const files = await collectTsFiles(srcDir);
  const offenders = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");
    if (text.includes("new Pool(") && !text.includes("attachPoolErrorLogger")) {
      offenders.push(path.relative(srcDir, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `pg.Pool sites without an error listener (idle-client errors crash the process): ${offenders.join(", ")}`
  );
});

test("attachPoolErrorLogger absorbs idle-client errors instead of crashing", async () => {
  const { attachPoolErrorLogger } = await import(
    path.join(__dirname, "..", "dist", "services", "pg-pool.js")
  );
  // pg.Pool extends EventEmitter; an un-listened "error" event throws.
  const pool = new EventEmitter();
  attachPoolErrorLogger(pool, "test-pool");
  pool.emit("error", new Error("idle client terminated"));
  assert.ok(true, "error event was absorbed");
});
