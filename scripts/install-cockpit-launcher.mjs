import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const appPath =
  process.env.BRAIN_COCKPIT_LAUNCHER_APP ||
  path.join(os.homedir(), "Desktop", "Brain Cockpit.app");
const label =
  process.env.BRAIN_COCKPIT_LAUNCHD_LABEL || "com.jem.brain-cockpit";
const url = process.env.BRAIN_COCKPIT_URL || "http://127.0.0.1:8787/";
const bundleId =
  process.env.BRAIN_COCKPIT_LAUNCHER_BUNDLE_ID ||
  "com.jem.brain-cockpit.launcher";
const appName = path.basename(appPath, ".app") || "Brain Cockpit";
const contentsDir = path.join(appPath, "Contents");
const macosDir = path.join(contentsDir, "MacOS");
const resourcesDir = path.join(contentsDir, "Resources");
const executablePath = path.join(macosDir, appName);

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
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${xmlEscape(appName)}</string>
  <key>CFBundleExecutable</key>
  <string>${xmlEscape(appName)}</string>
  <key>CFBundleIdentifier</key>
  <string>${xmlEscape(bundleId)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${xmlEscape(appName)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;

const executable = `#!/bin/zsh
set -u

LABEL="\${BRAIN_COCKPIT_LAUNCHD_LABEL:-${label}}"
URL="\${BRAIN_COCKPIT_URL:-${url}}"
DOMAIN="gui/$(id -u)"
PLIST_PATH="\${HOME}/Library/LaunchAgents/\${LABEL}.plist"

if ! /bin/launchctl print "\${DOMAIN}/\${LABEL}" >/dev/null 2>&1; then
  if [ -f "\${PLIST_PATH}" ]; then
    /bin/launchctl bootstrap "\${DOMAIN}" "\${PLIST_PATH}" >/dev/null 2>&1 || true
  fi
fi

/bin/launchctl kickstart -k "\${DOMAIN}/\${LABEL}" >/dev/null 2>&1 || true
/usr/bin/open "\${URL}"
`;

await fs.mkdir(macosDir, { recursive: true });
await fs.mkdir(resourcesDir, { recursive: true });
await fs.writeFile(path.join(contentsDir, "Info.plist"), plist, "utf-8");
await fs.writeFile(executablePath, executable, { encoding: "utf-8", mode: 0o755 });
await fs.chmod(executablePath, 0o755);

console.log(
  JSON.stringify(
    {
      appPath,
      executablePath,
      label,
      url,
      note: "Double-click the app to open Brain Cockpit.",
    },
    null,
    2
  )
);
