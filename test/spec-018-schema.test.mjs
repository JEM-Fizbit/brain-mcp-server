import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(__dirname, "..");

test("Spec 018 migration keeps grants and audit private and tenant-stable", async () => {
  const sql = await fs.readFile(path.join(repo, "db", "migrations", "2026-08-25_001_entra_access_grants.sql"), "utf-8");
  assert.match(sql, /provider_tenant_id text not null/);
  assert.match(sql, /unique index[\s\S]+provider, provider_tenant_id, provider_user_id/);
  assert.match(sql, /create table if not exists brain\.access_audit_events/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke update, delete on brain\.access_audit_events from brain_runtime/);
  assert.match(sql, /grant select, insert on brain\.access_audit_events to brain_runtime/);
  assert.match(sql, /for select[\s\S]+to brain_runtime[\s\S]+using \(true\)/);
  assert.match(sql, /for insert[\s\S]+to brain_runtime[\s\S]+with check \(true\)/);
  assert.doesNotMatch(sql, /access_audit_events[\s\S]+for all[\s\S]+to brain_runtime/);
  assert.doesNotMatch(sql, /access_audit_events[\s\S]+on delete cascade/);
  assert.match(sql, /revoke all on table brain\.access_audit_events from public/);
  assert.match(sql, /revoke all on table brain\.access_audit_events from anon/);
  assert.match(sql, /revoke all on table brain\.access_audit_events from authenticated/);
  assert.doesNotMatch(sql, /grant[^;]+to (anon|authenticated|public)/i);
});

test("local Cockpit exposes hosted Access & Roles navigation only for ers-brain", async () => {
  const source = await fs.readFile(path.join(repo, "scripts", "hosted-cockpit.mjs"), "utf-8");
  assert.match(source, /cockpitBrainId === "ers-brain"/);
  assert.match(source, /id="access-roles-link"/);
  assert.match(source, /BRAIN_COCKPIT_ACCESS_ADMIN_URL/);
  assert.doesNotMatch(source, /Graph access token|graphAccessToken/);
});

test("ERS Cockpit profile starts with the hosted Access & Roles navigation", async () => {
  const child = spawn(process.execPath, [path.join(repo, "scripts", "hosted-cockpit.mjs")], {
    cwd: repo,
    env: {
      ...process.env,
      BRAIN_ID: "ers-brain",
      BRAIN_COCKPIT_PORT: "0",
      BRAIN_COCKPIT_PORT_FALLBACK: "0",
      BRAIN_COCKPIT_ACCESS_ADMIN_URL: "https://brain.example.test/admin/access",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const started = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Cockpit did not start: ${output}`)), 5_000);
    const inspect = (chunk) => {
      output += chunk.toString();
      if (output.includes("Brain cockpit listening")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", (code) => {
      if (!output.includes("Brain cockpit listening")) {
        clearTimeout(timeout);
        reject(new Error(`Cockpit exited ${code}: ${output}`));
      }
    });
  });
  try {
    await started;
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
});
