import fs from "node:fs/promises";
import path from "node:path";
import {
  BRAIN_DIR,
  LOADER_FILE,
  NOW_FILE,
  LINE_LIMIT,
  BLOAT_EXEMPT,
  STALENESS,
  ACTIVE_PATTERNS,
  IDENTITY_PATTERNS,
  INACTIVE_SECTION_PATTERNS,
  ACTIVE_SECTION_PATTERNS,
  DOMAIN_PACK_LIMIT,
  WORKING_DIR,
  WORKING_INDEX_FILE,
  JOURNAL_FILE,
  JOURNAL_ARCHIVE_DIR,
  JOURNAL_ARCHIVE_INDEX,
  JOURNAL_LINE_LIMIT,
  JOURNAL_BYTE_LIMIT,
} from "../constants.js";
import { listFileNames, getStalenessThreshold } from "./brain.js";
import * as log from "./log.js";

export interface LintReport {
  bloat: { file: string; lines: number }[];
  stale: { file: string; days: number }[];
  orphans: string[];
  drift: string[];
  largeDomainPacks: { dir: string; count: number }[];
  unindexedWorkingBinaries: string[];
  journalRotation:
    | {
        lines: number;
        bytes: number;
        triggeredBy: "lines" | "bytes" | "both";
      }
    | null;
  suggestedSemanticChecks: string[];
  warnings: string[];
}

/**
 * Scan `working/` for non-markdown, non-.gitkeep files and verify each is
 * registered in `working/INDEX.md` with a `## {filename}` H2 section. Binaries
 * aren't indexed by brain_search, so the INDEX entry is what makes them
 * discoverable from inside a Brain session.
 */
async function findUnindexedWorkingBinaries(): Promise<string[]> {
  const workingDir = path.join(BRAIN_DIR, WORKING_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(workingDir);
  } catch {
    return [];
  }

  const binaries = entries.filter((name) => {
    if (name === WORKING_INDEX_FILE) return false;
    if (name === ".gitkeep" || name === ".DS_Store") return false;
    if (name.toLowerCase().endsWith(".md")) return false;
    return true;
  });

  if (binaries.length === 0) return [];

  let indexContent = "";
  try {
    indexContent = await fs.readFile(
      path.join(workingDir, WORKING_INDEX_FILE),
      "utf-8"
    );
  } catch {
    // INDEX.md missing entirely — every binary is unindexed.
    return binaries.map((b) => `${WORKING_DIR}/${b}`);
  }

  const indexedFilenames = new Set<string>();
  const h2Pattern = /^##\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = h2Pattern.exec(indexContent)) !== null) {
    indexedFilenames.add(match[1].trim());
  }

  const unindexed: string[] = [];
  for (const binary of binaries) {
    if (!indexedFilenames.has(binary)) {
      unindexed.push(`${WORKING_DIR}/${binary}`);
    }
  }
  return unindexed;
}

/**
 * Check whether `JOURNAL.md` has grown past the rotation threshold. JOURNAL is
 * a durable narrative timeline; once it crosses ~500 lines or ~80 KB the
 * rotation procedure in `brain/archive/INDEX.md` should be run to move older
 * entries into a numbered archive segment. Size-triggered so cadence auto-
 * scales with actual usage volume.
 */
async function checkJournalRotation(): Promise<LintReport["journalRotation"]> {
  const journalPath = path.join(BRAIN_DIR, JOURNAL_FILE);
  let content: string;
  let bytes: number;
  try {
    const stat = await fs.stat(journalPath);
    bytes = stat.size;
    content = await fs.readFile(journalPath, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n").length;
  const overLines = lines > JOURNAL_LINE_LIMIT;
  const overBytes = bytes > JOURNAL_BYTE_LIMIT;
  if (!overLines && !overBytes) return null;

  const triggeredBy: "lines" | "bytes" | "both" =
    overLines && overBytes ? "both" : overLines ? "lines" : "bytes";
  return { lines, bytes, triggeredBy };
}

/** Extract all .md file references from a markdown file */
async function extractFileReferences(filename: string): Promise<Set<string>> {
  const filePath = path.join(BRAIN_DIR, filename);
  const content = await fs.readFile(filePath, "utf-8");
  const refs = new Set<string>();

  // Match backtick-quoted filenames like `01_identity.md`
  const backtickPattern = /`([^`]+\.md)`/g;
  let match: RegExpExecArray | null;
  while ((match = backtickPattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  // Match directory references like `Reference_ERS_Brain_Context/`
  const dirPattern = /`([A-Za-z_][A-Za-z0-9_-]*\/)`/g;
  while ((match = dirPattern.exec(content)) !== null) {
    refs.add(match[1]);
  }

  return refs;
}

export async function runLint(): Promise<LintReport> {
  const allFiles = await listFileNames();
  const now = Date.now();

  const bloat: LintReport["bloat"] = [];
  const stale: LintReport["stale"] = [];
  const fileLinesMap = new Map<string, number>();

  // Check bloat and staleness for all files
  for (const name of allFiles) {
    const filePath = path.join(BRAIN_DIR, name);
    const [stat, content] = await Promise.all([
      fs.stat(filePath),
      fs.readFile(filePath, "utf-8"),
    ]);

    const lines = content.split("\n").length;
    fileLinesMap.set(name, lines);

    if (lines > LINE_LIMIT && !BLOAT_EXEMPT.has(path.basename(name))) {
      bloat.push({ file: name, lines });
    }

    const daysSinceModified = Math.floor(
      (now - stat.mtimeMs) / (1000 * 60 * 60 * 24)
    );
    const threshold = getStalenessThreshold(name);
    if (daysSinceModified > threshold) {
      stale.push({ file: name, days: daysSinceModified });
    }
  }

  // Orphan detection: files not referenced in 00_loader.md
  const loaderRefs = await extractFileReferences(LOADER_FILE);
  const orphans: string[] = [];
  for (const name of allFiles) {
    const base = path.basename(name);
    const dir = path.dirname(name);

    // Skip the loader itself and LOG.md
    if (base === LOADER_FILE || base === "LOG.md") continue;

    // Check if file is referenced directly or via its directory
    const isReferenced =
      loaderRefs.has(name) ||
      loaderRefs.has(base) ||
      (dir !== "." && loaderRefs.has(dir + "/"));

    if (!isReferenced) {
      orphans.push(name);
    }
  }

  // Drift detection: check NOW.md mentions against Active project sections
  const drift: string[] = [];
  const warnings: string[] = [];
  try {
    const nowPath = path.join(BRAIN_DIR, NOW_FILE);
    const nowContent = await fs.readFile(nowPath, "utf-8");
    const nowLower = nowContent.toLowerCase();

    const projectsPath = path.join(BRAIN_DIR, "05_projects.md");
    try {
      const projectsContent = await fs.readFile(projectsPath, "utf-8");
      const lines = projectsContent.split("\n");

      // First pass: build {section: [project headings]} map.
      const sections = new Map<string, string[]>();
      let currentSection = "";
      for (const line of lines) {
        const h2Match = line.match(/^##\s+(.+)/);
        if (h2Match) {
          currentSection = h2Match[1].trim();
          if (!sections.has(currentSection)) sections.set(currentSection, []);
          continue;
        }
        const h3Match = line.match(/^###\s+(.+)/);
        if (!h3Match || !currentSection) continue;
        const project = h3Match[1].trim();
        if (project.length <= 3 || project.includes("---")) continue;
        sections.get(currentSection)!.push(project);
      }

      const activeSections = [...sections.keys()].filter((name) =>
        ACTIVE_SECTION_PATTERNS.some((p) => p.test(name))
      );

      const checkProject = (project: string) => {
        const projectLower = project.toLowerCase();
        const segments = projectLower
          .split(/\s*[—–\-\(\),\/]\s*/)
          .map((s) => s.trim())
          .filter((s) => s.length > 3);
        const mentioned = segments.some((seg) => nowLower.includes(seg));
        if (!mentioned) {
          drift.push(
            `Project "${project}" in 05_projects.md not mentioned in NOW.md — still active?`
          );
        }
      };

      if (activeSections.length > 0) {
        // Active-section scoping: only drift-check projects under Active sections.
        for (const section of activeSections) {
          for (const project of sections.get(section)!) checkProject(project);
        }
      } else {
        // Defensive fallback: no parseable Active section. Warn and use the
        // legacy inactive-section filter so drift checks still surface signal
        // rather than crashing or going silent.
        warnings.push(
          "Drift check: no Active section found in 05_projects.md (expected a heading matching /active/i). " +
            "Falling back to legacy filter — every project not under an inactive section will be drift-checked. " +
            "Add an Active section header to 05_projects.md to silence this warning."
        );
        for (const [section, projects] of sections) {
          if (INACTIVE_SECTION_PATTERNS.some((p) => p.test(section))) continue;
          for (const project of projects) checkProject(project);
        }
      }
    } catch {
      // 05_projects.md doesn't exist, skip
    }
  } catch {
    // NOW.md doesn't exist, skip
  }

  // Unindexed working binaries
  const unindexedWorkingBinaries = await findUnindexedWorkingBinaries();

  // Journal rotation threshold
  const journalRotation = await checkJournalRotation();

  // Large domain packs
  const largeDomainPacks: LintReport["largeDomainPacks"] = [];
  const dirCounts = new Map<string, number>();
  for (const name of allFiles) {
    const dir = path.dirname(name);
    if (dir !== ".") {
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
    }
  }
  for (const [dir, count] of dirCounts) {
    if (count > DOMAIN_PACK_LIMIT) {
      largeDomainPacks.push({ dir, count });
    }
  }

  // Suggested semantic checks for Claude to perform
  const suggestedSemanticChecks: string[] = [];
  if (stale.length > 0) {
    suggestedSemanticChecks.push(
      `Review stale files for outdated claims: ${stale.map((s) => s.file).join(", ")}`
    );
  }
  if (bloat.length > 0) {
    suggestedSemanticChecks.push(
      `Consider splitting bloated files: ${bloat.map((b) => `${b.file} (${b.lines} lines)`).join(", ")}`
    );
  }
  suggestedSemanticChecks.push(
    "Cross-check key facts in 01_identity.md against REF_extracted_facts.md for contradictions"
  );
  suggestedSemanticChecks.push(
    "Verify active roles in 04_active_roles.md match current state in NOW.md"
  );

  return {
    bloat,
    stale,
    orphans,
    drift,
    largeDomainPacks,
    unindexedWorkingBinaries,
    journalRotation,
    suggestedSemanticChecks,
    warnings,
  };
}

export function formatLintReport(report: LintReport): string {
  const sections: string[] = ["# Brain Lint Report\n"];

  // Summary
  const issueCount =
    report.bloat.length +
    report.stale.length +
    report.orphans.length +
    report.drift.length +
    report.largeDomainPacks.length +
    report.unindexedWorkingBinaries.length +
    (report.journalRotation ? 1 : 0);

  sections.push(
    issueCount === 0
      ? "**All clear** — no structural issues detected.\n"
      : `**${issueCount} issue(s) found:**\n`
  );

  // Warnings (e.g. drift fallback when no Active section is parseable)
  if (report.warnings.length > 0) {
    sections.push("## Warnings");
    for (const w of report.warnings) {
      sections.push(`- ${w}`);
    }
    sections.push("");
  }

  // Bloat
  if (report.bloat.length > 0) {
    sections.push(`## Bloat (files exceeding ${LINE_LIMIT} lines)`);
    for (const { file, lines } of report.bloat) {
      sections.push(`- ${file}: ${lines} lines`);
    }
    sections.push("");
  }

  // Stale
  if (report.stale.length > 0) {
    sections.push("## Stale files");
    for (const { file, days } of report.stale) {
      sections.push(`- ${file}: ${days} days since last modification`);
    }
    sections.push("");
  }

  // Orphans
  if (report.orphans.length > 0) {
    sections.push("## Orphans (not referenced in loader)");
    for (const file of report.orphans) {
      sections.push(`- ${file}`);
    }
    sections.push("");
  }

  // Drift
  if (report.drift.length > 0) {
    sections.push("## Drift");
    for (const item of report.drift) {
      sections.push(`- ${item}`);
    }
    sections.push("");
  }

  // Journal rotation
  if (report.journalRotation) {
    const { lines, bytes, triggeredBy } = report.journalRotation;
    const kb = (bytes / 1024).toFixed(1);
    const limitKb = (JOURNAL_BYTE_LIMIT / 1024).toFixed(0);
    const reason =
      triggeredBy === "lines"
        ? `${lines} lines (threshold ${JOURNAL_LINE_LIMIT})`
        : triggeredBy === "bytes"
        ? `${kb} KB (threshold ${limitKb} KB)`
        : `${lines} lines and ${kb} KB (thresholds ${JOURNAL_LINE_LIMIT} lines / ${limitKb} KB)`;
    sections.push(
      "## Journal rotation due",
      `- ${JOURNAL_FILE} has reached ${reason}.`,
      `- Run the rotation procedure in \`${JOURNAL_ARCHIVE_DIR}/${JOURNAL_ARCHIVE_INDEX}\`: cut ≈30 days back at a date header, move older entries into \`${JOURNAL_ARCHIVE_DIR}/JOURNAL-YYYY-NN.md\`, register the segment in \`${JOURNAL_ARCHIVE_DIR}/${JOURNAL_ARCHIVE_INDEX}\` with date range + one-line summary, and log the rotation in LOG.md as an UPDATE op.`,
      ""
    );
  }

  // Unindexed working binaries
  if (report.unindexedWorkingBinaries.length > 0) {
    sections.push(
      "## Unindexed working binaries (missing from working/INDEX.md)"
    );
    for (const file of report.unindexedWorkingBinaries) {
      sections.push(`- ${file}`);
    }
    sections.push(
      "",
      "Add a `## <filename>` section to `working/INDEX.md` describing each binary (purpose, key terms, schema, how to read/edit). Without it, brain_search cannot discover the artifact.",
      ""
    );
  }

  // Large domain packs
  if (report.largeDomainPacks.length > 0) {
    sections.push(`## Large domain packs (>${DOMAIN_PACK_LIMIT} files)`);
    for (const { dir, count } of report.largeDomainPacks) {
      sections.push(`- ${dir}/: ${count} files`);
    }
    sections.push("");
  }

  // Suggested semantic checks
  sections.push("## Suggested next steps (for Claude)");
  for (const check of report.suggestedSemanticChecks) {
    sections.push(`- ${check}`);
  }

  return sections.join("\n");
}
