import { brainDate } from "./date.js";

export const TASKS_FILE = "TASKS.md";
export const INTAKE_HEADING = "## Inbox / Handoff Queue";

export const INTAKE_DESCRIPTION =
  "Temporary capture queue for bugs, feature requests, observations, investigations, and follow-up work reported through conversational AI surfaces before triage into the canonical project backlog or project-management system.";

export const INTAKE_TRIAGE_LINE =
  "Transfer to the authoritative backlog, then mark transferred/closed.";

export const INTAKE_KINDS = [
  "bug",
  "feature",
  "observation",
  "investigation",
  "follow_up",
] as const;

export type IntakeKind = (typeof INTAKE_KINDS)[number];
export type IntakeUrgency = "low" | "normal" | "high";

export interface IntakeItem {
  kind: IntakeKind;
  title: string;
  source?: string;
  target?: string;
  details?: string;
  urgency?: IntakeUrgency;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function kindLabel(kind: IntakeKind): string {
  return kind.replace("_", "-").toUpperCase();
}

function formatIntakeItem(item: IntakeItem, now: Date): string {
  const lines = [
    `- [ ] ${brainDate(now)} — ${kindLabel(item.kind)} — ${singleLine(item.title)}`,
  ];

  if (item.source) lines.push(`  - Source: ${singleLine(item.source)}`);
  if (item.target) lines.push(`  - Target: ${singleLine(item.target)}`);
  lines.push(`  - Urgency: ${item.urgency || "normal"}`);
  if (item.details) lines.push(`  - Details: ${singleLine(item.details)}`);
  lines.push(`  - Triage: ${INTAKE_TRIAGE_LINE}`);

  return lines.join("\n");
}

function newQueueSection(entry: string): string {
  return [
    INTAKE_HEADING,
    "",
    INTAKE_DESCRIPTION,
    "",
    entry,
    "",
  ].join("\n");
}

export function appendIntakeItemToTasks(
  content: string,
  item: IntakeItem,
  now = new Date()
): string {
  const entry = formatIntakeItem(item, now);
  const queuePattern = /^## Inbox \/ Handoff Queue\s*$/m;
  const queueMatch = content.match(queuePattern);

  if (!queueMatch || queueMatch.index === undefined) {
    const section = newQueueSection(entry);
    const activeMatch = content.match(/^## Active\s*$/m);
    if (activeMatch && activeMatch.index !== undefined) {
      return [
        content.slice(0, activeMatch.index).trimEnd(),
        section.trimEnd(),
        content.slice(activeMatch.index).trimStart(),
      ].join("\n\n") + "\n";
    }
    return `${content.trimEnd()}\n\n${section}`;
  }

  const queueStart = queueMatch.index;
  const afterHeadingIndex = queueStart + queueMatch[0].length;
  const rest = content.slice(afterHeadingIndex);
  const nextHeadingRelative = rest.search(/\n## /);
  const queueEnd =
    nextHeadingRelative === -1
      ? content.length
      : afterHeadingIndex + nextHeadingRelative + 1;
  const queueBody = content.slice(afterHeadingIndex, queueEnd);
  const firstItemRelative = queueBody.search(/\n- \[[ xX]\] /);

  if (firstItemRelative !== -1) {
    const insertAt = afterHeadingIndex + firstItemRelative + 1;
    return `${content.slice(0, insertAt)}${entry}\n${content.slice(insertAt)}`;
  }

  const insertAt = queueEnd;
  const prefix = content.slice(0, insertAt).trimEnd();
  const suffix = content.slice(insertAt).trimStart();
  return suffix
    ? `${prefix}\n\n${entry}\n\n${suffix}`
    : `${prefix}\n\n${entry}\n`;
}
