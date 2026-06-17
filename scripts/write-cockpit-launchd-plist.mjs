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
      url: `http://${host}:${port}/`,
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
