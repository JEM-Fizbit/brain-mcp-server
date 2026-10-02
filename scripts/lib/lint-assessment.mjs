import { countLintIssues } from "../../dist/services/lint.js";

function lintReviewFindings(report) {
  const findings = [];
  const add = (kind, summary, detail = "", metadata = {}) =>
    findings.push({
      kind,
      summary,
      detail,
      audience: "maintainer",
      owner: "Brain content maintainer",
      ...metadata,
    });
  for (const item of report.bloat || []) {
    add("bloat", `${item.file} is ${item.lines} lines`, "Review whether the file should be split; lint will not rewrite semantic content.");
  }
  for (const item of report.stale || []) {
    add("stale", `${item.file} is ${item.days} days stale`, "Review the claims and update or intentionally retain them.");
  }
  for (const filename of report.orphans || []) {
    add("orphan", `${filename} is not reachable`, `Reachability mode: ${report.orphanMode || "legacy"}. Structural files are never auto-edited.`);
  }
  for (const item of report.drift || []) add("drift", item, "Confirm the active-project and NOW.md relationship.");
  for (const item of report.largeDomainPacks || []) {
    add("large_domain_pack", `${item.dir}/ contains ${item.count} files`, "Review the pack's navigation and progressive disclosure.");
  }
  for (const filename of report.unindexedWorkingBinaries || []) {
    add("unindexed_binary", `${filename} is missing from working/INDEX.md`, "Add a reviewed INDEX entry; Cockpit will not fabricate the description.");
  }
  if (report.journalRotation) {
    add("journal_rotation", "Journal rotation is due", `Triggered by ${report.journalRotation.triggeredBy}; rotation remains a reviewed content move.`);
  }
  if (report.captureQueue) {
    add(
      "capture_queue",
      `Capture queue has ${report.captureQueue.openCount} open item(s)`,
      `${report.captureQueue.staleCount} stale item(s); this is one bounded content-triage decision, not ${report.captureQueue.openCount} lint diagnostics.`,
      {
        audience: "operator",
        owner: "John",
        statusLabel: "User decision",
        completion: "Complete when the capture queue is triaged into its canonical trackers or closed.",
        openCount: report.captureQueue.openCount,
        staleCount: report.captureQueue.staleCount,
        thresholdDays: report.captureQueue.thresholdDays,
      }
    );
  }
  if (report.bootstrapBudget?.exceeded) {
    add(
      "bootstrap_budget",
      `Bootstrap estimate ${report.bootstrapBudget.estimatedTokens} exceeds ${report.bootstrapBudget.limitTokens} tokens`,
      "Review progressive-disclosure moves; 00_loader.md and NOW.md are protected from automatic fixes."
    );
  }
  return findings;
}

function lintTechnicalDiagnostics(report, sourceLinkAudit) {
  const findings = [];
  const add = (kind, summary, detail, metadata = {}) =>
    findings.push({
      kind,
      summary,
      detail,
      audience: "maintainer",
      operatorAction: false,
      owner: "Brain content maintainer",
      ...metadata,
    });
  const graphDiagnostics = report.graphReachability?.diagnostics || [];
  if (graphDiagnostics.length > 0) {
    const byCode = new Map();
    for (const diagnostic of graphDiagnostics) {
      const group = byCode.get(diagnostic.code) || [];
      group.push(diagnostic);
      byCode.set(diagnostic.code, group);
    }
    const definitions = {
      unresolved_target: {
        label: "Broken internal-link candidates",
        status: "Maintainer repair required",
        detail:
          "A real Markdown link or wikilink does not resolve inside the Brain. Backtick project locators and source-boundary links have already been excluded from this class.",
        owner: "Brain content maintainer",
        completion: "Complete when the internal destination is repaired or the link is deliberately removed.",
      },
      missing_directory_index: {
        label: "Directory references without a Brain index",
        status: "Maintainer repair required",
        detail:
          "A real Brain link names a directory that has no README.md or INDEX.md inside the Brain.",
        owner: "Brain content maintainer",
        completion: "Complete when each route is either linked to its canonical external workspace or given a reviewed Brain index where one is genuinely useful.",
      },
      path_escape: {
        label: "Paths outside the Brain namespace",
        status: "Maintainer repair required",
        detail:
          "A real Markdown link escapes the Brain namespace. Machine locators are classified separately and do not enter this failure class.",
        owner: "Brain content maintainer",
        completion: "Complete when human-facing routes are portable hyperlinks or explicitly retained as machine-only locators.",
      },
    };
    for (const [code, diagnostics] of Array.from(byCode.entries()).sort(
      (left, right) => right[1].length - left[1].length
    )) {
      const definition = definitions[code] || {
        label: code,
        status: "Maintainer repair required",
        detail: "This internal graph failure is retained for maintainer repair and is never delegated to the operator.",
        owner: "Brain content maintainer",
        completion: "Complete when the maintainer has classified or repaired the affected references.",
      };
      add(
        "broken_internal_links",
        `${diagnostics.length} ${definition.label.toLowerCase()} diagnostic(s)`,
        definition.detail,
        {
          diagnosticCode: code,
          statusLabel: definition.status,
          owner: definition.owner,
          completion: definition.completion,
          examples: diagnostics.slice(0, 5).map((diagnostic) =>
            `${diagnostic.source} → ${diagnostic.target}`
          ),
        }
      );
    }
  }

  const externalReferences = report.graphReachability?.externalReferences || [];
  const byReason = new Map();
  for (const reference of externalReferences) {
    const group = byReason.get(reference.reason) || [];
    group.push(reference);
    byReason.set(reference.reason, group);
  }
  const definitions = {
    source_boundary: {
      label: "reviewed source links",
      status:
        sourceLinkAudit?.state === "pass"
          ? "Verified automatically"
          : sourceLinkAudit?.state === "fail"
            ? "Strict source audit failed"
            : "Verification unavailable",
      detail:
        sourceLinkAudit?.state === "pass"
          ? `The strict local source audit passes across ${sourceLinkAudit.sourceCompanions} companions, so these links are satisfied and closed automatically.`
          : "These links leave brain/ for sources/. They remain outside graph reachability and are owned by the strict repository-wide source audit.",
      owner: "Automated source-link audit",
      completion:
        sourceLinkAudit?.state === "pass"
          ? "Complete; no operator review required."
          : "Complete when the strict source-link audit passes.",
    },
    outside_brain: {
      label: "external workspace locators",
      status: "Classified informational",
      detail:
        "Absolute and parent-relative machine locators are retained for LLM traceability but are not Brain navigation links.",
      completion: "Complete by classification; no operator review required.",
    },
    unresolved_locator: {
      label: "project/file locators",
      status: "Classified informational",
      detail:
        "Backtick file references describe project-owned or templated locators. They are not clickable Brain links and do not imply a missing Brain node.",
      completion: "Complete by classification; no operator review required.",
    },
    directory_locator: {
      label: "project/directory locators",
      status: "Classified informational",
      detail:
        "Backtick directory references route agents to external workspaces. They do not require a Brain index page.",
      completion: "Complete by classification; no operator review required.",
    },
  };
  for (const [reason, references] of Array.from(byReason.entries()).sort(
    (left, right) => right[1].length - left[1].length
  )) {
    const definition = definitions[reason] || definitions.outside_brain;
    add(
      "classified_reference",
      `${references.length} ${definition.label}`,
      definition.detail,
      {
        diagnosticCode: reason,
        statusLabel: definition.status,
        owner: definition.owner || "Brain content maintainer",
        completion: definition.completion,
        examples: references.slice(0, 5).map((reference) =>
          `${reference.source} → ${reference.target}`
        ),
      }
    );
  }
  return findings;
}

export function lintAssessment({ brainId, report, plan, sourceLinkAudit, checkedAt = new Date().toISOString() }) {
  const issueCount = countLintIssues(report);
  const diagnosticCount = report.graphReachability?.diagnostics.length || 0;
  const externalReferenceCount = report.graphReachability?.externalReferences?.length || 0;
  const reviewFindings = lintReviewFindings(report);
  const operatorDecisionCount = reviewFindings.filter(f => f.audience === "operator").length;
  return {
    version: 2, brainId, checkedAt,
    status: plan.items.length || operatorDecisionCount ? "warn"
      : issueCount || diagnosticCount || sourceLinkAudit.state === "fail" ? "info" : "pass",
    issueCount, primaryIssueCount: issueCount, diagnosticCount, externalReferenceCount,
    automaticFixCount: plan.items.length, operatorDecisionCount,
    maintainerFindingCount: reviewFindings.length - operatorDecisionCount,
    reviewFindings, technicalDiagnostics: lintTechnicalDiagnostics(report, sourceLinkAudit),
    sourceLinkAudit, warnings: report.warnings || [], report,
  };
}
