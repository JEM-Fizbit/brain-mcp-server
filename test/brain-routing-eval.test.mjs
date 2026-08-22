import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateBrainRoutingGolden,
  summarizeBrainRoutingResults,
} from "../evals/brain-routing/evaluator.mjs";

const fixtureBrains = {
  "ai-brain-jem": {
    files: {
      "00_loader.md": [
        "# Loader",
        "John's contact details / public profiles / email address / phone number / mobile / headshots | `01_identity.md`; use `08_personal.md` only for private home/family/location context; use `09_tools_stack.md` for service-specific account identifiers/logins",
        "ERS Genomics context | Use the accessible canonical ERS Brain when available (currently `ers-brain`). If unavailable, use `ers_genomics.md` as John's personal summary/bridge and `Reference_ERS_Brain_Context/` as legacy fallback; state that fallback may lag.",
        "Stable identifiers vs secrets: store non-secret identifiers; refuse authenticating secrets.",
        "Reading source archives: escalate to `sources` or `all` when a query clearly implicates original ingested material.",
      ].join("\n"),
      "01_identity.md": "Email address\nPhone number / mobile\n",
      "quanta.md": "## Canonical destinations\n- **Official website:** [Quanta](https://quantadt.com/)\n",
      "09_tools_stack.md": "UChicago account: CNetID and email alias are stable non-secret account identifiers. No passwords, tokens, MFA secrets, recovery codes, or private keys.\n",
      "ers_genomics.md": "John's personal summary/bridge. Authoritative ERS-owned facts live in the accessible canonical ERS Brain when available.\n",
    },
  },
  "ers-brain": {
    files: {
      "00_loader.md": "company facts, history, positioning | entities/ers_genomics.md\nERS staff/CEO professional contact details / email address / phone number / approved signature block | entities/*.md; references/templates.md\n",
      "entities/john_milad.md": "ERS Work Contact Details\nEmail address\nPhone number / mobile\n",
      "references/templates.md": "Approved signature block\n",
    },
  },
};

const fixtureRegistry = {
  brains: [
    {
      id: "ai-brain-jem",
      metadata: {
        owner_scope: "personal",
        canonical_for: ["john-milad", "personal-context"],
        authority_tier: "canonical",
      },
    },
    {
      id: "ers-brain",
      metadata: {
        owner_scope: "company",
        canonical_for: ["ers-genomics", "ers-company-context"],
        authority_tier: "canonical",
      },
    },
  ],
};

test("brain routing eval passes route, registry, policy, and fuzzy-search cases", () => {
  const golden = [
    {
      id: "personal-contact-email",
      prompt: "What is my email address?",
      category: "personal_contact",
      expected: {
        brain_id: "ai-brain-jem",
        route_files: ["01_identity.md"],
        loader_must_contain: ["contact details", "01_identity.md", "08_personal.md"],
        search: { query: "my email address", must_hit_files: ["01_identity.md"] },
      },
    },
    {
      id: "uchicago-cnetid",
      prompt: "Save my UChicago CNetID.",
      category: "stable_identifier",
      expected: {
        brain_id: "ai-brain-jem",
        route_files: ["09_tools_stack.md"],
        allow_store_non_secret_identifier: true,
        refuse_secret_storage: true,
        loader_must_contain: ["Stable identifiers vs secrets"],
        search: { query: "uchicago cnet id", must_hit_files: ["09_tools_stack.md"] },
      },
    },
    {
      id: "quanta-destination",
      prompt: "Take me to Quanta.",
      category: "semantic_destination",
      expected: {
        brain_id: "ai-brain-jem",
        route_files: ["quanta.md"],
        destinations: [
          {
            file: "quanta.md",
            url: "https://quantadt.com/",
            status_marker: "Official website",
          },
        ],
      },
    },
    {
      id: "ers-company-fact",
      prompt: "What is the ERS company address?",
      category: "cross_brain_authority",
      expected: {
        brain_id: "ers-brain",
        canonical_for: "ers-genomics",
        loader_must_contain: ["company facts", "entities/ers_genomics.md"],
      },
    },
    {
      id: "ers-unavailable-fallback",
      prompt: "Use the JEM Brain for ERS context when ERS Brain is unavailable.",
      category: "cross_brain_fallback",
      expected: {
        brain_id: "ai-brain-jem",
        route_files: ["ers_genomics.md"],
        fallback_disclosure_required: true,
        loader_must_contain: ["Reference_ERS_Brain_Context", "may lag"],
      },
    },
  ];

  const results = evaluateBrainRoutingGolden({
    cases: golden,
    brains: fixtureBrains,
    registry: fixtureRegistry,
  });

  assert.equal(results.status, "pass");
  assert.equal(results.summary.total, 5);
  assert.equal(results.summary.failed, 0);
  assert.match(summarizeBrainRoutingResults(results), /PASS 5\/5/);
});

test("brain routing eval reports missing required routes", () => {
  const results = evaluateBrainRoutingGolden({
    cases: [
      {
        id: "missing-contact-route",
        prompt: "What is my phone number?",
        category: "personal_contact",
        expected: {
          brain_id: "ai-brain-jem",
          route_files: ["01_identity.md"],
          search: { query: "phone number", must_hit_files: ["01_identity.md"] },
        },
      },
    ],
    brains: {
      "ai-brain-jem": {
        files: {
          "00_loader.md": "Personal context | `08_personal.md`\n",
          "08_personal.md": "Private home context\n",
        },
      },
    },
    registry: fixtureRegistry,
  });

  assert.equal(results.status, "fail");
  assert.equal(results.summary.failed, 1);
  assert.deepEqual(results.cases[0].failures, [
    "Expected route file 01_identity.md to exist in ai-brain-jem.",
    "Search query \"phone number\" did not hit required file 01_identity.md in ai-brain-jem.",
  ]);
});
