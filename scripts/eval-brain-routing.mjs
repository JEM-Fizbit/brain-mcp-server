#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateBrainRoutingGolden,
  readJsonFile,
  readMarkdownTree,
  summarizeBrainRoutingResults,
} from "../evals/brain-routing/evaluator.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const defaultBrainDirs = {
  "ai-brain-jem": path.join(os.homedir(), "Projects", "ai-brain-jem", "brain"),
  "ers-brain": path.join(
    os.homedir(),
    "Library",
    "CloudStorage",
    "OneDrive-SharedLibraries-ERSGenomics",
    "Systems & IT - Documents",
    "01_ers-brain",
    "brain"
  ),
};

function usage() {
  return [
    "Usage: npm run eval:brain:routing -- [options]",
    "",
    "Options:",
    "  --golden <path>     Golden-case JSON file",
    "  --registry <path>   Brain registry JSON file",
    "  --jem-dir <path>    Local ai-brain-jem markdown root",
    "  --ers-dir <path>    Local ers-brain markdown root",
    "  --json              Emit machine-readable results after the summary",
    "  --help              Show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    golden: path.join(repoRoot, "evals", "brain-routing", "golden.json"),
    registry: path.join(repoRoot, "config", "brain-platform.john-ers-pilot.json"),
    brainDirs: {
      "ai-brain-jem": process.env.BRAIN_EVAL_JEM_DIR || defaultBrainDirs["ai-brain-jem"],
      "ers-brain": process.env.BRAIN_EVAL_ERS_DIR || defaultBrainDirs["ers-brain"],
    },
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split("=", 2);
    const nextValue = () => inlineValue ?? argv[++index];

    if (flag === "--help" || flag === "-h") {
      options.help = true;
    } else if (flag === "--json") {
      options.json = true;
    } else if (flag === "--golden") {
      options.golden = path.resolve(nextValue());
    } else if (flag === "--registry") {
      options.registry = path.resolve(nextValue());
    } else if (flag === "--jem-dir") {
      options.brainDirs["ai-brain-jem"] = path.resolve(nextValue());
    } else if (flag === "--ers-dir") {
      options.brainDirs["ers-brain"] = path.resolve(nextValue());
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    }
  }

  return options;
}

async function pathExists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch {
    return false;
  }
}

async function loadBrains(brainDirs) {
  const brains = {};
  const missing = [];

  for (const [brainId, rootDir] of Object.entries(brainDirs)) {
    if (await pathExists(rootDir)) {
      brains[brainId] = await readMarkdownTree(rootDir);
    } else {
      missing.push(`${brainId}: ${rootDir}`);
    }
  }

  return { brains, missing };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const [cases, registry, loaded] = await Promise.all([
    readJsonFile(options.golden),
    readJsonFile(options.registry),
    loadBrains(options.brainDirs),
  ]);

  const results = evaluateBrainRoutingGolden({
    cases,
    registry,
    brains: loaded.brains,
  });

  console.log(summarizeBrainRoutingResults(results));
  if (loaded.missing.length > 0) {
    console.log("");
    console.log("Missing Brain roots:");
    for (const missing of loaded.missing) {
      console.log(`- ${missing}`);
    }
  }

  if (options.json) {
    console.log("");
    console.log(JSON.stringify(results, null, 2));
  }

  process.exitCode = results.status === "pass" ? 0 : 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
