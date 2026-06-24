import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { appendIntakeItemToTasks } = await import(
  path.join(__dirname, "..", "dist", "services", "task-intake.js")
);

test("appendIntakeItemToTasks creates the capture triage queue before Active", () => {
  const existing = [
    "# TASKS",
    "",
    "Scope: Brain-scoped tasks.",
    "",
    "## Active",
    "",
    "- [ ] Existing active item",
    "",
  ].join("\n");

  const next = appendIntakeItemToTasks(
    existing,
    {
      kind: "feature",
      title: "Conversational intake",
      source: "Claude mobile",
      route_hint: "brain-mcp-server",
      details: "Capture before triage.",
      urgency: "normal",
    },
    new Date("2026-06-24T12:00:00.000Z")
  );

  assert.ok(
    next.indexOf("## Capture / Triage Queue") < next.indexOf("## Active"),
    "queue should be discoverable before regular active work"
  );
  assert.doesNotMatch(next, /## Inbox \/ Handoff Queue/);
  assert.match(next, /Not the document-ingestion inbox/);
  assert.match(next, /FEATURE — Conversational intake/);
  assert.match(next, /Source: Claude mobile/);
  assert.match(next, /Route hint: brain-mcp-server/);
  assert.match(next, /Details: Capture before triage\./);
});

test("appendIntakeItemToTasks prepends newer items within an existing queue", () => {
  const existing = [
    "# TASKS",
    "",
    "## Capture / Triage Queue",
    "",
    "Temporary queue.",
    "",
    "- [ ] 2026-06-23 — BUG — Older item",
    "  - Source: ChatGPT mobile",
    "  - Triage: Transfer to the authoritative backlog, then mark transferred/closed.",
    "",
    "## Active",
    "",
  ].join("\n");

  const next = appendIntakeItemToTasks(
    existing,
    {
      kind: "investigation",
      title: "Newer item",
      source: "ChatGPT mobile",
      urgency: "high",
    },
    new Date("2026-06-24T12:00:00.000Z")
  );

  assert.ok(
    next.indexOf("INVESTIGATION — Newer item") < next.indexOf("BUG — Older item"),
    "newer intake items should be first in the queue"
  );
  assert.match(next, /Urgency: high/);
});

test("appendIntakeItemToTasks migrates an existing handoff queue heading", () => {
  const existing = [
    "# TASKS",
    "",
    "## Inbox / Handoff Queue",
    "",
    "Temporary queue.",
    "",
    "- [ ] 2026-06-23 — BUG — Older item",
    "  - Source: ChatGPT mobile",
    "  - Triage: Transfer to the authoritative backlog, then mark transferred/closed.",
    "",
    "## Active",
    "",
  ].join("\n");

  const next = appendIntakeItemToTasks(
    existing,
    {
      kind: "idea",
      title: "Browser-based Brain viewer",
      source: "ChatGPT iPhone",
      route_hint: "brain-platform",
      urgency: "normal",
    },
    new Date("2026-06-24T12:00:00.000Z")
  );

  assert.match(next, /## Capture \/ Triage Queue/);
  assert.doesNotMatch(next, /## Inbox \/ Handoff Queue/);
  assert.ok(
    next.indexOf("IDEA — Browser-based Brain viewer") <
      next.indexOf("BUG — Older item"),
    "newer capture items should be first after heading migration"
  );
  assert.match(next, /Route hint: brain-platform/);
});
