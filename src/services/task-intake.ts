import { brainDate } from "./date.js";

export const TASKS_FILE = "TASKS.md";
export const INTAKE_HEADING = "## Capture / Triage Queue";
const LEGACY_INTAKE_HEADING = "## Inbox / Handoff Queue";

export const INTAKE_DESCRIPTION =
  "Temporary holding area for conversationally captured items that need later routing. Not the document-ingestion inbox. Not a canonical destination.";

export const INTAKE_TRIAGE_LINE =
  "Route to canonical destination, then mark transferred/closed.";
export const CAPTURE_QUEUE_STALE_DAYS = 7;
export const CAPTURE_QUEUE_WARN_COUNT = 10;

export const INTAKE_KINDS = [
  "bug",
  "feature",
  "observation",
  "investigation",
  "follow_up",
  "idea",
  "question",
  "reminder",
  "note",
  "routing",
] as const;

export type IntakeKind = (typeof INTAKE_KINDS)[number];
export type IntakeUrgency = "low" | "normal" | "high";

export interface IntakeItem {
  kind: IntakeKind;
  title: string;
  source?: string;
  target?: string;
  route_hint?: string;
  details?: string;
  urgency?: IntakeUrgency;
}

export interface CaptureQueueStatus {
  openCount: number;
  staleCount: number;
  oldestOpenDays: number | null;
  staleItems: { title: string; date: string; days: number }[];
  thresholdDays: number;
  thresholdCount: number;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function kindLabel(kind: IntakeKind): string {
  return kind.replace("_", "-").toUpperCase();
}

function formatIntakeItem(item: IntakeItem, now: Date): string {
  const routeHint = item.route_hint || item.target;
  const lines = [
    `- [ ] ${brainDate(now)} — ${kindLabel(item.kind)} — ${singleLine(item.title)}`,
  ];

  if (item.source) lines.push(`  - Source: ${singleLine(item.source)}`);
  if (routeHint) lines.push(`  - Route hint: ${singleLine(routeHint)}`);
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
  let base = content;
  const queuePattern = /^## (?:Capture \/ Triage Queue|Inbox \/ Handoff Queue)\s*$/m;
  let queueMatch = base.match(queuePattern);

  if (queueMatch?.index !== undefined && queueMatch[0].trim() === LEGACY_INTAKE_HEADING) {
    base =
      base.slice(0, queueMatch.index) +
      INTAKE_HEADING +
      base.slice(queueMatch.index + queueMatch[0].length);
    queueMatch = base.match(queuePattern);
  }

  if (!queueMatch || queueMatch.index === undefined) {
    const section = newQueueSection(entry);
    const activeMatch = base.match(/^## Active\s*$/m);
    if (activeMatch && activeMatch.index !== undefined) {
      return [
        base.slice(0, activeMatch.index).trimEnd(),
        section.trimEnd(),
        base.slice(activeMatch.index).trimStart(),
      ].join("\n\n") + "\n";
    }
    return `${base.trimEnd()}\n\n${section}`;
  }

  const queueStart = queueMatch.index;
  const afterHeadingIndex = queueStart + queueMatch[0].length;
  const rest = base.slice(afterHeadingIndex);
  const nextHeadingRelative = rest.search(/\n## /);
  const queueEnd =
    nextHeadingRelative === -1
      ? base.length
      : afterHeadingIndex + nextHeadingRelative + 1;
  const queueBody = base.slice(afterHeadingIndex, queueEnd);
  const firstItemRelative = queueBody.search(/\n- \[[ xX]\] /);

  if (firstItemRelative !== -1) {
    const insertAt = afterHeadingIndex + firstItemRelative + 1;
    return `${base.slice(0, insertAt)}${entry}\n${base.slice(insertAt)}`;
  }

  const insertAt = queueEnd;
  const prefix = base.slice(0, insertAt).trimEnd();
  const suffix = base.slice(insertAt).trimStart();
  return suffix
    ? `${prefix}\n\n${entry}\n\n${suffix}`
    : `${prefix}\n\n${entry}\n`;
}

function captureQueueSection(content: string): string | null {
  const queuePattern = /^## (?:Capture \/ Triage Queue|Inbox \/ Handoff Queue)\s*$/m;
  const queueMatch = content.match(queuePattern);
  if (!queueMatch || queueMatch.index === undefined) return null;

  const afterHeadingIndex = queueMatch.index + queueMatch[0].length;
  const rest = content.slice(afterHeadingIndex);
  const nextHeadingRelative = rest.search(/\n## /);
  const queueEnd =
    nextHeadingRelative === -1
      ? content.length
      : afterHeadingIndex + nextHeadingRelative + 1;
  return content.slice(afterHeadingIndex, queueEnd);
}

function daysSince(date: string, now: Date): number {
  const [year, month, day] = date.split("-").map(Number);
  const capturedAt = Date.UTC(year, month - 1, day);
  const nowAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((nowAt - capturedAt) / (1000 * 60 * 60 * 24)));
}

export function summarizeCaptureQueue(
  tasksContent: string | undefined,
  now = new Date()
): CaptureQueueStatus | null {
  if (!tasksContent) return null;

  const section = captureQueueSection(tasksContent);
  if (!section) return null;

  const openItems: { title: string; date: string; days: number }[] = [];
  const itemPattern =
    /^- \[([ xX])\]\s+(\d{4}-\d{2}-\d{2})\s+—\s+[A-Z-]+\s+—\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(section)) !== null) {
    const checked = match[1].toLowerCase() === "x";
    if (checked) continue;

    const date = match[2];
    openItems.push({
      title: match[3].trim(),
      date,
      days: daysSince(date, now),
    });
  }

  if (openItems.length === 0) return null;

  const staleItems = openItems.filter(
    (item) => item.days >= CAPTURE_QUEUE_STALE_DAYS
  );
  if (
    staleItems.length === 0 &&
    openItems.length < CAPTURE_QUEUE_WARN_COUNT
  ) {
    return null;
  }

  return {
    openCount: openItems.length,
    staleCount: staleItems.length,
    oldestOpenDays: Math.max(...openItems.map((item) => item.days)),
    staleItems,
    thresholdDays: CAPTURE_QUEUE_STALE_DAYS,
    thresholdCount: CAPTURE_QUEUE_WARN_COUNT,
  };
}
