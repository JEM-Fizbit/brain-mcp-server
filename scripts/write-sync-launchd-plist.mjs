import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const brainRoot =
  process.env.BRAIN_REPO_ROOT || path.join(os.homedir(), "Projects", "ai-brain-jem");
const brainDir = process.env.BRAIN_DIR || path.join(brainRoot, "brain");
const syncDir = path.resolve(brainDir, "..", ".brain-sync");
const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const stateFile = process.env.BRAIN_SYNC_STATE_FILE;
const lockFile = process.env.BRAIN_SYNC_LOCK_FILE;
const healthFile = process.env.BRAIN_SYNC_HEALTH_FILE;
const logDir = process.env.BRAIN_SYNC_LAUNCHD_LOG_DIR || syncDir;
const label = process.env.BRAIN_SYNC_LAUNCHD_LABEL || "com.jem.brain-sync";
const intervalSeconds = Number(process.env.BRAIN_SYNC_LAUNCHD_INTERVAL_SECONDS || 5);
const nodePath = process.env.BRAIN_SYNC_LAUNCHD_NODE || process.execPath;
const syncCliPath =
  process.env.BRAIN_SYNC_LAUNCHD_SYNC_CLI ||
  path.join(repoRoot, "dist", "sync", "cli.js");
const outputPath =
  process.env.BRAIN_SYNC_LAUNCHD_PLIST ||
  path.join(repoRoot, "tmp", `${label}.plist`);

if (!path.isAbsolute(nodePath)) {
  throw new Error(`BRAIN_SYNC_LAUNCHD_NODE must be absolute: ${nodePath}`);
}

if (!path.isAbsolute(syncCliPath)) {
  throw new Error(`BRAIN_SYNC_LAUNCHD_SYNC_CLI must be absolute: ${syncCliPath}`);
}

for (const [name, value] of [
  ["BRAIN_SYNC_STATE_FILE", stateFile],
  ["BRAIN_SYNC_LOCK_FILE", lockFile],
  ["BRAIN_SYNC_HEALTH_FILE", healthFile],
  ["BRAIN_SYNC_LAUNCHD_LOG_DIR", logDir],
]) {
  if (value && !path.isAbsolute(value)) {
    throw new Error(`${name} must be absolute: ${value}`);
  }
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>

  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(syncCliPath)}</string>
    <string>watch</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>BRAIN_ID</key>
    <string>${xmlEscape(brainId)}</string>
    <key>BRAIN_DIR</key>
    <string>${xmlEscape(brainDir)}</string>
    ${
      stateFile
        ? `<key>BRAIN_SYNC_STATE_FILE</key>
    <string>${xmlEscape(stateFile)}</string>`
        : ""
    }
    ${
      lockFile
        ? `<key>BRAIN_SYNC_LOCK_FILE</key>
    <string>${xmlEscape(lockFile)}</string>`
        : ""
    }
    ${
      healthFile
        ? `<key>BRAIN_SYNC_HEALTH_FILE</key>
    <string>${xmlEscape(healthFile)}</string>`
        : ""
    }
    <key>BRAIN_SYNC_INTERVAL_MS</key>
    <string>${xmlEscape(String(intervalSeconds * 1000))}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>${Math.max(1, intervalSeconds)}</integer>

  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logDir, "launchd.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logDir, "launchd.err.log"))}</string>
</dict>
</plist>
`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(logDir, { recursive: true });
if (stateFile) await fs.mkdir(path.dirname(stateFile), { recursive: true });
await fs.writeFile(outputPath, plist, "utf-8");
console.log(
  JSON.stringify(
    {
      outputPath,
      label,
      brainId,
      brainDir,
      stateFile: stateFile || null,
      lockFile: lockFile || null,
      healthFile: healthFile || null,
      logDir,
      intervalSeconds,
      nodePath,
      syncCliPath,
      note: "Review before copying to ~/Library/LaunchAgents and loading with launchctl.",
    },
    null,
    2
  )
);
