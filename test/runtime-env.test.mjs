import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  assertHttpIdentityConfig,
  runtimeBrainId,
} = await import(path.join(__dirname, "..", "dist", "services", "runtime-env.js"));

test("stdio keeps the documented local Brain default", () => {
  assert.equal(runtimeBrainId({}), "ai-brain-jem");
});

test("HTTP mode requires an explicit BRAIN_ID", () => {
  assert.throws(
    () => runtimeBrainId({ TRANSPORT: "http" }),
    /BRAIN_ID is required when TRANSPORT=http/
  );
});

test("HTTP mode rejects GITHUB_ALLOWED fallbacks without explicit opt-in", () => {
  assert.throws(
    () => assertHttpIdentityConfig({
      TRANSPORT: "http",
      BRAIN_ID: "ai-brain-jem",
      GITHUB_ALLOWED_LOGINS: "example",
    }),
    /BRAIN_GITHUB_ALLOWED_FALLBACK=1/
  );
});

test("HTTP mode permits the legacy fallback only with explicit opt-in", () => {
  assert.doesNotThrow(() => assertHttpIdentityConfig({
    TRANSPORT: "http",
    BRAIN_ID: "ai-brain-jem",
    GITHUB_ALLOWED_EMAILS: "example@example.com",
    BRAIN_GITHUB_ALLOWED_FALLBACK: "1",
  }));
});
