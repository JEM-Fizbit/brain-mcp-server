import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const appPath =
  process.env.BRAIN_SYNC_HELPER_APP ||
  path.join(os.homedir(), "Applications", "Brain Sync.app");
const label =
  process.env.BRAIN_SYNC_HELPER_LAUNCHD_LABEL ||
  "com.jem.brain-sync.helper";
const logDir =
  process.env.BRAIN_SYNC_LAUNCHD_LOG_DIR ||
  path.join(os.homedir(), "Library", "Application Support", "Brain MCP", "sync-helper");
const outputPath =
  process.env.BRAIN_SYNC_HELPER_LAUNCHD_PLIST ||
  path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);

if (!path.isAbsolute(appPath)) {
  throw new Error(`BRAIN_SYNC_HELPER_APP must be absolute: ${appPath}`);
}

if (!path.isAbsolute(logDir)) {
  throw new Error(`BRAIN_SYNC_LAUNCHD_LOG_DIR must be absolute: ${logDir}`);
}

if (!path.isAbsolute(outputPath)) {
  throw new Error(
    `BRAIN_SYNC_HELPER_LAUNCHD_PLIST must be absolute: ${outputPath}`
  );
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

  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-W</string>
    <string>${xmlEscape(appPath)}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ProcessType</key>
  <string>Interactive</string>

  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logDir, "sync-helper-launchd.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logDir, "sync-helper-launchd.err.log"))}</string>
</dict>
</plist>
`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(logDir, { recursive: true });
await fs.writeFile(outputPath, plist, "utf-8");

console.log(
  JSON.stringify(
    {
      outputPath,
      label,
      appPath,
      logDir,
      note:
        "Install this LaunchAgent after granting the helper app Full Disk Access.",
    },
    null,
    2
  )
);
