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
const syncStateFile = process.env.BRAIN_SYNC_STATE_FILE;
const syncLockFile = process.env.BRAIN_SYNC_LOCK_FILE;
const syncHealthFile = process.env.BRAIN_SYNC_HEALTH_FILE;
const syncLaunchdLabel = process.env.BRAIN_SYNC_LAUNCHD_LABEL;
const label =
  process.env.BRAIN_COCKPIT_LAUNCHD_LABEL || "com.jem.brain-cockpit";
const nodePath = process.env.BRAIN_COCKPIT_LAUNCHD_NODE || process.execPath;
const cockpitScriptPath =
  process.env.BRAIN_COCKPIT_LAUNCHD_SCRIPT ||
  path.join(repoRoot, "scripts", "hosted-cockpit.mjs");
const host = process.env.BRAIN_COCKPIT_HOST || "127.0.0.1";
const port = Number(process.env.BRAIN_COCKPIT_PORT || 8787);
const runtimePath =
  process.env.BRAIN_COCKPIT_LAUNCHD_PATH ||
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const outputPath =
  process.env.BRAIN_COCKPIT_LAUNCHD_PLIST ||
  path.join(repoRoot, "tmp", `${label}.plist`);

if (!path.isAbsolute(nodePath)) {
  throw new Error(`BRAIN_COCKPIT_LAUNCHD_NODE must be absolute: ${nodePath}`);
}

if (!path.isAbsolute(cockpitScriptPath)) {
  throw new Error(
    `BRAIN_COCKPIT_LAUNCHD_SCRIPT must be absolute: ${cockpitScriptPath}`
  );
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`BRAIN_COCKPIT_PORT must be a valid TCP port: ${port}`);
}

for (const [name, value] of [
  ["BRAIN_SYNC_STATE_FILE", syncStateFile],
  ["BRAIN_SYNC_LOCK_FILE", syncLockFile],
  ["BRAIN_SYNC_HEALTH_FILE", syncHealthFile],
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
    <string>${xmlEscape(cockpitScriptPath)}</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>BRAIN_ID</key>
    <string>${xmlEscape(brainId)}</string>
    <key>BRAIN_DIR</key>
    <string>${xmlEscape(brainDir)}</string>
    ${
      syncStateFile
        ? `<key>BRAIN_SYNC_STATE_FILE</key>
    <string>${xmlEscape(syncStateFile)}</string>`
        : ""
    }
    ${
      syncLockFile
        ? `<key>BRAIN_SYNC_LOCK_FILE</key>
    <string>${xmlEscape(syncLockFile)}</string>`
        : ""
    }
    ${
      syncHealthFile
        ? `<key>BRAIN_SYNC_HEALTH_FILE</key>
    <string>${xmlEscape(syncHealthFile)}</string>`
        : ""
    }
    ${
      syncLaunchdLabel
        ? `<key>BRAIN_SYNC_LAUNCHD_LABEL</key>
    <string>${xmlEscape(syncLaunchdLabel)}</string>`
        : ""
    }
    <key>BRAIN_COCKPIT_HOST</key>
    <string>${xmlEscape(host)}</string>
    <key>BRAIN_COCKPIT_PORT</key>
    <string>${xmlEscape(String(port))}</string>
    <key>BRAIN_COCKPIT_PORT_FALLBACK</key>
    <string>0</string>
    <key>PATH</key>
    <string>${xmlEscape(runtimePath)}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(syncDir, "cockpit.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(syncDir, "cockpit.err.log"))}</string>
</dict>
</plist>
`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, plist, "utf-8");
console.log(
  JSON.stringify(
    {
      outputPath,
      label,
      brainId,
      url: `http://${host}:${port}/`,
      syncStateFile: syncStateFile || null,
      syncLockFile: syncLockFile || null,
      syncHealthFile: syncHealthFile || null,
      syncLaunchdLabel: syncLaunchdLabel || null,
      nodePath,
      cockpitScriptPath,
      host,
      port,
      path: runtimePath,
      note: "Review before copying to ~/Library/LaunchAgents and loading with launchctl.",
    },
    null,
    2
  )
);
