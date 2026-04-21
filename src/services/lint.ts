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
} from "../constants.js";
import { listFileNames, getStalenessThreshold } from "./brain.js";
import * as log from "./log.js";

export interface LintReport {
  bloat: { file: string; lines: number }[];
  stale: { file: string; days: number }[];
  orphans: string[];
  drift: string[];
  largeDomainPacks: { dir: string; count: number }[];
  suggestedSemanticChecks: string[];
  warnings: string[];
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
    report.largeDomainPacks.length;

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
