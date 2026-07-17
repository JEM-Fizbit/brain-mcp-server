import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-request-context-test-"));
const registryFile = path.join(tmpDir, "registry.json");

process.env.BRAIN_PLATFORM_CONFIG = registryFile;

const requestContext = await import(
  path.join(__dirname, "..", "dist", "services", "request-context.js")
);

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("write-role authorization allows known writers and rejects reader or unknown roles", () => {
  const base = {
    brainId: "ai-brain-jem",
    brain: {},
    principal: { provider: "github", providerUserId: "123" },
  };
  for (const role of ["owner", "admin", "member"]) {
    assert.doesNotThrow(() => requestContext.assertWriteRole({ ...base, role }));
  }
  assert.throws(
    () => requestContext.assertWriteRole({ ...base, role: "reader" }),
    /write access denied/i
  );
  assert.throws(
    () => requestContext.assertWriteRole({ ...base, role: "editor" }),
    /unknown role editor/i
  );
});

test("listBrainsForExtra exposes registry authority metadata for accessible Brains", async () => {
  await fs.writeFile(
    registryFile,
    JSON.stringify(
      {
        version: 1,
        default_brain_id: "ai-brain-jem",
        brains: [
          {
            id: "ai-brain-jem",
            type: "personal",
            template_used: "personal",
            integration_mode: "vertical",
            storage_backend: "postgres",
            storage_config: {},
            metadata: {
              owner_scope: "personal",
              canonical_for: ["john-milad", "personal-context"],
              authority_tier: "canonical",
              fallback_note: "Use user-provided context if inaccessible.",
            },
          },
          {
            id: "ers-brain",
            type: "shared",
            template_used: "ers",
            integration_mode: "vertical",
            storage_backend: "postgres",
            storage_config: {},
            metadata: {
              owner_scope: "company",
              canonical_for: ["ers-genomics", "ers-work-context"],
              authority_tier: "canonical",
              fallback_note: "Use bridge summaries only as fallback.",
            },
          },
        ],
        principals: [
          {
            provider: "github",
            provider_user_id: "123",
            roles: { "ai-brain-jem": "owner", "ers-brain": "reader" },
          },
        ],
      },
      null,
      2
    ),
    "utf-8"
  );

  const brains = await requestContext.listBrainsForExtra({
    authInfo: {
      extra: {
        provider: "github",
        provider_user_id: "123",
      },
    },
  });

  assert.deepEqual(
    brains.map((brain) => ({
      id: brain.id,
      role: brain.role,
      metadata: brain.metadata,
    })),
    [
      {
        id: "ai-brain-jem",
        role: "owner",
        metadata: {
          owner_scope: "personal",
          canonical_for: ["john-milad", "personal-context"],
          authority_tier: "canonical",
          fallback_note: "Use user-provided context if inaccessible.",
        },
      },
      {
        id: "ers-brain",
        role: "reader",
        metadata: {
          owner_scope: "company",
          canonical_for: ["ers-genomics", "ers-work-context"],
          authority_tier: "canonical",
          fallback_note: "Use bridge summaries only as fallback.",
        },
      },
    ]
  );
});
