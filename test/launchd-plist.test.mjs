import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "..", "scripts", "write-sync-launchd-plist.mjs");
const cockpitScriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "write-cockpit-launchd-plist.mjs"
);
const launcherScriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "install-cockpit-launcher.mjs"
);
const syncHelperScriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "install-sync-helper-app.mjs"
);
const syncHelperLaunchdScriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "write-sync-helper-launchd-plist.mjs"
);
const menuBarScriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "install-brain-menubar-app.mjs"
);
const menuBarLaunchdScriptPath = path.join(
  __dirname,
  "..",
  "scripts",
  "write-brain-menubar-launchd-plist.mjs"
);
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "brain-launchd-test-"));

after(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

test("launchd plist runs the sync CLI with an absolute Node path", async () => {
  const outputPath = path.join(tmpRoot, "com.example.brain-sync.plist");
  const brainRoot = path.join(tmpRoot, "ai-brain");
  const nodePath = "/opt/example/bin/node";
  const syncCliPath = path.join(tmpRoot, "repo", "dist", "sync", "cli.js");

  const { stdout } = await exec(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_SYNC_LAUNCHD_LABEL: "com.example.brain-sync",
      BRAIN_SYNC_LAUNCHD_NODE: nodePath,
      BRAIN_SYNC_LAUNCHD_SYNC_CLI: syncCliPath,
      BRAIN_SYNC_LAUNCHD_PLIST: outputPath,
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.outputPath, outputPath);
  assert.equal(result.nodePath, nodePath);
  assert.equal(result.syncCliPath, syncCliPath);
  assert.match(plist, new RegExp(`<string>${nodePath}</string>`));
  assert.match(plist, new RegExp(`<string>${syncCliPath}</string>`));
  assert.doesNotMatch(plist, /<string>\/usr\/bin\/env<\/string>/);
  assert.doesNotMatch(plist, /<string>npm<\/string>/);
  assert.doesNotMatch(plist, /<string>run<\/string>/);
  assert.match(plist, new RegExp(`<string>${path.join(brainRoot, "brain")}</string>`));
});

test("sync launchd plist pins the explicit brain_id for multi-Brain safety", async () => {
  const outputPath = path.join(tmpRoot, "com.example.ers-brain-sync.plist");
  const brainRoot = path.join(tmpRoot, "ers-brain");

  const { stdout } = await exec(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      BRAIN_ID: "ers-brain",
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_SYNC_LAUNCHD_LABEL: "com.example.ers-brain-sync",
      BRAIN_SYNC_LAUNCHD_PLIST: outputPath,
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.brainId, "ers-brain");
  assert.match(plist, /<key>BRAIN_ID<\/key>\s*<string>ers-brain<\/string>/);
  assert.match(
    plist,
    new RegExp(`<key>BRAIN_DIR</key>\\s*<string>${path.join(brainRoot, "brain")}</string>`)
  );
});

test("sync launchd plist supports external state and log paths", async () => {
  const outputPath = path.join(tmpRoot, "com.example.cloud-brain-sync.plist");
  const brainRoot = path.join(tmpRoot, "cloud-brain");
  const stateFile = path.join(tmpRoot, "state", "cloud-brain", "state.json");
  const logDir = path.join(tmpRoot, "logs", "cloud-brain");

  const { stdout } = await exec(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      BRAIN_ID: "ers-brain",
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_SYNC_STATE_FILE: stateFile,
      BRAIN_SYNC_LAUNCHD_LOG_DIR: logDir,
      BRAIN_SYNC_LAUNCHD_LABEL: "com.example.cloud-brain-sync",
      BRAIN_SYNC_LAUNCHD_PLIST: outputPath,
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.stateFile, stateFile);
  assert.equal(result.logDir, logDir);
  assert.match(plist, new RegExp(`<key>BRAIN_SYNC_STATE_FILE</key>\\s*<string>${stateFile}</string>`));
  assert.match(plist, new RegExp(`<string>${path.join(logDir, "launchd.out.log")}</string>`));
  assert.match(plist, new RegExp(`<string>${path.join(logDir, "launchd.err.log")}</string>`));
});

test("cockpit launchd plist runs local cockpit with a stable loopback URL", async () => {
  const outputPath = path.join(tmpRoot, "com.example.brain-cockpit.plist");
  const brainRoot = path.join(tmpRoot, "ai-brain");
  const nodePath = "/opt/example/bin/node";
  const hostedCockpitPath = path.join(tmpRoot, "repo", "scripts", "hosted-cockpit.mjs");

  const { stdout } = await exec(process.execPath, [cockpitScriptPath], {
    env: {
      ...process.env,
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_COCKPIT_LAUNCHD_LABEL: "com.example.brain-cockpit",
      BRAIN_COCKPIT_LAUNCHD_NODE: nodePath,
      BRAIN_COCKPIT_LAUNCHD_SCRIPT: hostedCockpitPath,
      BRAIN_COCKPIT_LAUNCHD_PLIST: outputPath,
      BRAIN_COCKPIT_PORT: "8799",
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.outputPath, outputPath);
  assert.equal(result.url, "http://127.0.0.1:8799/");
  assert.equal(result.nodePath, nodePath);
  assert.equal(result.cockpitScriptPath, hostedCockpitPath);
  assert.match(result.path, /\/opt\/homebrew\/bin/);
  assert.match(plist, new RegExp(`<string>${nodePath}</string>`));
  assert.match(plist, new RegExp(`<string>${hostedCockpitPath}</string>`));
  assert.match(plist, /<key>BRAIN_COCKPIT_HOST<\/key>\s*<string>127\.0\.0\.1<\/string>/);
  assert.match(plist, /<key>BRAIN_COCKPIT_PORT<\/key>\s*<string>8799<\/string>/);
  assert.match(plist, /<key>BRAIN_COCKPIT_PORT_FALLBACK<\/key>\s*<string>0<\/string>/);
  assert.match(plist, /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:/);
  assert.match(plist, /cockpit\.out\.log/);
  assert.match(plist, /cockpit\.err\.log/);
  assert.doesNotMatch(plist, /<string>\/usr\/bin\/env<\/string>/);
  assert.doesNotMatch(plist, /<string>npm<\/string>/);
  assert.doesNotMatch(plist, /<string>run<\/string>/);
});

test("cockpit launchd plist pins the explicit brain_id for per-Brain doctor views", async () => {
  const outputPath = path.join(tmpRoot, "com.example.ers-brain-cockpit.plist");
  const brainRoot = path.join(tmpRoot, "ers-brain");

  const { stdout } = await exec(process.execPath, [cockpitScriptPath], {
    env: {
      ...process.env,
      BRAIN_ID: "ers-brain",
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_COCKPIT_LAUNCHD_LABEL: "com.example.ers-brain-cockpit",
      BRAIN_COCKPIT_LAUNCHD_PLIST: outputPath,
      BRAIN_COCKPIT_PORT: "8798",
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.brainId, "ers-brain");
  assert.match(plist, /<key>BRAIN_ID<\/key>\s*<string>ers-brain<\/string>/);
});

test("cockpit launchd plist passes per-Brain sync state through to doctor", async () => {
  const outputPath = path.join(tmpRoot, "com.example.cloud-brain-cockpit.plist");
  const brainRoot = path.join(tmpRoot, "cloud-brain");
  const stateFile = path.join(tmpRoot, "state", "cloud-brain", "state.json");
  const syncLabel = "com.example.cloud-brain-sync";

  const { stdout } = await exec(process.execPath, [cockpitScriptPath], {
    env: {
      ...process.env,
      BRAIN_ID: "ers-brain",
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_SYNC_STATE_FILE: stateFile,
      BRAIN_SYNC_LAUNCHD_LABEL: syncLabel,
      BRAIN_COCKPIT_LAUNCHD_LABEL: "com.example.cloud-brain-cockpit",
      BRAIN_COCKPIT_LAUNCHD_PLIST: outputPath,
      BRAIN_COCKPIT_PORT: "8798",
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.syncStateFile, stateFile);
  assert.equal(result.syncLaunchdLabel, syncLabel);
  assert.match(plist, new RegExp(`<key>BRAIN_SYNC_STATE_FILE</key>\\s*<string>${stateFile}</string>`));
  assert.match(plist, new RegExp(`<key>BRAIN_SYNC_LAUNCHD_LABEL</key>\\s*<string>${syncLabel}</string>`));
});

test("desktop launcher app opens cockpit and kickstarts launchd service", async () => {
  const appPath = path.join(tmpRoot, "Brain Cockpit.app");

  const { stdout } = await exec(process.execPath, [launcherScriptPath], {
    env: {
      ...process.env,
      BRAIN_COCKPIT_LAUNCHER_APP: appPath,
      BRAIN_COCKPIT_LAUNCHD_LABEL: "com.example.brain-cockpit",
      BRAIN_COCKPIT_URL: "http://127.0.0.1:8799/",
    },
  });

  const result = JSON.parse(stdout);
  const infoPlist = await fs.readFile(path.join(appPath, "Contents", "Info.plist"), "utf-8");
  const executablePath = path.join(appPath, "Contents", "MacOS", "Brain Cockpit");
  const executable = await fs.readFile(executablePath, "utf-8");
  const stat = await fs.stat(executablePath);

  assert.equal(result.appPath, appPath);
  assert.equal(result.url, "http://127.0.0.1:8799/");
  assert.match(infoPlist, /<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);
  assert.match(infoPlist, /<key>LSUIElement<\/key>\s*<true\/>/);
  assert.match(executable, /launchctl print/);
  assert.match(executable, /launchctl bootstrap/);
  assert.match(executable, /launchctl kickstart -k/);
  assert.match(executable, /\/usr\/bin\/open "\$\{URL\}"/);
  assert.match(executable, /com\.example\.brain-cockpit/);
  assert.match(executable, /http:\/\/127\.0\.0\.1:8799\//);
  assert.notEqual(stat.mode & 0o111, 0);
});

test("sync helper app runs the sync CLI with pinned Brain and state paths", async () => {
  const appPath = path.join(tmpRoot, "ERS Brain Sync.app");
  const brainRoot = path.join(tmpRoot, "ers-brain");
  const stateFile = path.join(tmpRoot, "state", "ers-brain", "state.json");
  const logDir = path.join(tmpRoot, "logs", "ers-brain");
  const nodePath = "/opt/example/bin/node";
  const syncCliPath = path.join(tmpRoot, "repo", "dist", "sync", "cli.js");

  const { stdout } = await exec(process.execPath, [syncHelperScriptPath], {
    env: {
      ...process.env,
      BRAIN_SYNC_HELPER_APP: appPath,
      BRAIN_SYNC_HELPER_BUNDLE_ID: "com.example.ers-brain-sync",
      BRAIN_ID: "ers-brain",
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_SYNC_STATE_FILE: stateFile,
      BRAIN_SYNC_LAUNCHD_LOG_DIR: logDir,
      BRAIN_SYNC_LAUNCHD_NODE: nodePath,
      BRAIN_SYNC_LAUNCHD_SYNC_CLI: syncCliPath,
      BRAIN_SYNC_INTERVAL_MS: "7000",
    },
  });

  const result = JSON.parse(stdout);
  const infoPlist = await fs.readFile(path.join(appPath, "Contents", "Info.plist"), "utf-8");
  const executablePath = path.join(appPath, "Contents", "MacOS", "ERS Brain Sync");
  const executable = await fs.readFile(executablePath);
  const config = JSON.parse(
    await fs.readFile(
      path.join(appPath, "Contents", "Resources", "sync-helper-config.json"),
      "utf-8"
    )
  );
  const stat = await fs.stat(executablePath);

  assert.equal(result.appPath, appPath);
  assert.equal(result.launcherKind, "native");
  assert.equal(result.brainId, "ers-brain");
  assert.equal(result.brainDir, path.join(brainRoot, "brain"));
  assert.equal(result.stateFile, stateFile);
  assert.equal(result.logDir, logDir);
  assert.match(infoPlist, /<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);
  assert.match(infoPlist, /<key>LSUIElement<\/key>\s*<true\/>/);
  assert.notEqual(executable.subarray(0, 2).toString("utf-8"), "#!");
  assert.equal(config.env.BRAIN_ID, "ers-brain");
  assert.equal(config.env.BRAIN_DIR, path.join(brainRoot, "brain"));
  assert.equal(config.env.BRAIN_SYNC_STATE_FILE, stateFile);
  assert.equal(config.env.BRAIN_SYNC_INTERVAL_MS, "7000");
  assert.equal(config.nodePath, nodePath);
  assert.equal(config.syncCliPath, syncCliPath);
  assert.deepEqual(config.args, ["watch"]);
  assert.equal(config.stdoutPath, path.join(logDir, "sync-helper.out.log"));
  assert.equal(config.stderrPath, path.join(logDir, "sync-helper.err.log"));
  assert.notEqual(stat.mode & 0o111, 0);
});

test("sync helper defaults to the user Applications folder", async () => {
  const { stdout } = await exec(process.execPath, [syncHelperScriptPath], {
    env: {
      ...process.env,
      HOME: tmpRoot,
      BRAIN_SYNC_LAUNCHD_LOG_DIR: path.join(tmpRoot, "logs"),
    },
  });

  const result = JSON.parse(stdout);

  assert.equal(result.appPath, path.join(tmpRoot, "Applications", "Brain Sync.app"));
});

test("sync helper LaunchAgent opens the helper app at login", async () => {
  const outputPath = path.join(tmpRoot, "com.example.ers-brain-sync.helper.plist");
  const appPath = path.join(tmpRoot, "Applications", "ERS Brain Sync.app");
  const logDir = path.join(tmpRoot, "logs", "ers-brain");

  const { stdout } = await exec(process.execPath, [syncHelperLaunchdScriptPath], {
    env: {
      ...process.env,
      BRAIN_SYNC_HELPER_APP: appPath,
      BRAIN_SYNC_HELPER_LAUNCHD_LABEL: "com.example.ers-brain-sync.helper",
      BRAIN_SYNC_HELPER_LAUNCHD_PLIST: outputPath,
      BRAIN_SYNC_LAUNCHD_LOG_DIR: logDir,
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.outputPath, outputPath);
  assert.equal(result.appPath, appPath);
  assert.equal(result.label, "com.example.ers-brain-sync.helper");
  assert.match(plist, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/usr\/bin\/open<\/string>\s*<string>-W<\/string>/);
  assert.match(plist, new RegExp(`<string>${appPath}</string>`));
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>LimitLoadToSessionType<\/key>\s*<string>Aqua<\/string>/);
  assert.match(plist, new RegExp(`<string>${path.join(logDir, "sync-helper-launchd.out.log")}</string>`));
  assert.match(plist, new RegExp(`<string>${path.join(logDir, "sync-helper-launchd.err.log")}</string>`));
});

test("menu-bar app surfaces sync health and operator controls", async () => {
  const appPath = path.join(tmpRoot, "Applications", "ERS Brain Monitor.app");
  const brainRoot = path.join(tmpRoot, "ers-brain");
  const stateFile = path.join(tmpRoot, "state", "ers-brain", "state.json");
  const healthFile = path.join(tmpRoot, "state", "ers-brain", "state.health.json");
  const logDir = path.join(tmpRoot, "logs", "ers-brain");
  const nodePath = "/opt/example/bin/node";
  const doctorScriptPath = path.join(tmpRoot, "repo", "scripts", "hosted-doctor.mjs");
  const syncCliPath = path.join(tmpRoot, "repo", "dist", "sync", "cli.js");
  const cockpitScriptPath = path.join(tmpRoot, "repo", "scripts", "hosted-cockpit.mjs");

  const { stdout } = await exec(process.execPath, [menuBarScriptPath], {
    env: {
      ...process.env,
      BRAIN_MENUBAR_APP: appPath,
      BRAIN_MENUBAR_BUNDLE_ID: "com.example.ers-brain-monitor",
      BRAIN_ID: "ers-brain",
      BRAIN_REPO_ROOT: brainRoot,
      BRAIN_SYNC_STATE_FILE: stateFile,
      BRAIN_SYNC_HEALTH_FILE: healthFile,
      BRAIN_SYNC_LAUNCHD_LABEL: "com.example.ers-brain-sync.helper",
      BRAIN_COCKPIT_LAUNCHD_LABEL: "com.example.ers-brain-cockpit",
      BRAIN_COCKPIT_URL: "http://127.0.0.1:8798/",
      BRAIN_SYNC_LAUNCHD_LOG_DIR: logDir,
      BRAIN_MENUBAR_NODE: nodePath,
      BRAIN_MENUBAR_DOCTOR_SCRIPT: doctorScriptPath,
      BRAIN_MENUBAR_SYNC_CLI: syncCliPath,
      BRAIN_MENUBAR_COCKPIT_SCRIPT: cockpitScriptPath,
    },
  });

  const result = JSON.parse(stdout);
  const infoPlist = await fs.readFile(path.join(appPath, "Contents", "Info.plist"), "utf-8");
  const executablePath = path.join(appPath, "Contents", "MacOS", "ERS Brain Monitor");
  const executable = await fs.readFile(executablePath);
  const source = await fs.readFile(
    path.join(appPath, "Contents", "Resources", "brain-menubar-app.m"),
    "utf-8"
  );
  const config = JSON.parse(
    await fs.readFile(
      path.join(appPath, "Contents", "Resources", "brain-menubar-config.json"),
      "utf-8"
    )
  );
  const stat = await fs.stat(executablePath);

  assert.equal(result.appPath, appPath);
  assert.equal(result.launcherKind, "native_menubar");
  assert.equal(result.signed, true);
  assert.equal(result.brainId, "ers-brain");
  assert.equal(result.brainDir, path.join(brainRoot, "brain"));
  assert.equal(result.stateFile, stateFile);
  assert.equal(result.healthFile, healthFile);
  assert.equal(result.logDir, logDir);
  assert.equal(result.cockpitUrl, "http://127.0.0.1:8798/");
  assert.match(infoPlist, /<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);
  assert.match(infoPlist, /<key>LSUIElement<\/key>\s*<true\/>/);
  assert.notEqual(executable.subarray(0, 2).toString("utf-8"), "#!");
  assert.equal(config.brainId, "ers-brain");
  assert.equal(config.brainDir, path.join(brainRoot, "brain"));
  assert.equal(config.stateFile, stateFile);
  assert.equal(config.healthFile, healthFile);
  assert.equal(config.syncLaunchdLabel, "com.example.ers-brain-sync.helper");
  assert.equal(config.cockpitLaunchdLabel, "com.example.ers-brain-cockpit");
  assert.equal(config.cockpitUrl, "http://127.0.0.1:8798/");
  assert.equal(config.nodePath, nodePath);
  assert.equal(config.doctorScriptPath, doctorScriptPath);
  assert.equal(config.doctorOutputPath, path.join(logDir, "hosted-doctor.out.json"));
  assert.equal(config.doctorErrorPath, path.join(logDir, "hosted-doctor.err.log"));
  assert.equal(config.doctorIntervalMs, 60000);
  assert.equal(config.doctorInitialDelayMs, 10000);
  assert.equal(config.stackStatusFile, path.join(logDir, "brain-monitor-stack.json"));
  assert.equal(config.env.BRAIN_SYNC_SUPERVISOR, "menubar");
  assert.equal(config.env.BRAIN_PROFILE_NAME, "ers-brain");
  assert.equal(config.env.BRAIN_COCKPIT_URL, "http://127.0.0.1:8798/");
  assert.equal(config.env.BRAIN_SYNC_LOG_DIR, logDir);
  assert.equal(config.env.BRAIN_MONITOR_STACK_FILE, path.join(logDir, "brain-monitor-stack.json"));
  assert.deepEqual(JSON.parse(config.env.BRAIN_COCKPIT_PROFILES_JSON), [
    {
      brainId: "ers-brain",
      profileName: "ers-brain",
      stateFile,
      healthFile,
      logDir,
      cockpitUrl: "http://127.0.0.1:8798/",
    },
  ]);
  assert.equal(config.syncProcess.launchPath, nodePath);
  assert.deepEqual(config.syncProcess.arguments, [syncCliPath, "watch"]);
  assert.equal(config.syncProcess.stdoutPath, path.join(logDir, "monitor-sync.out.log"));
  assert.equal(config.syncProcess.stderrPath, path.join(logDir, "monitor-sync.err.log"));
  assert.equal(config.syncProcess.env.BRAIN_ID, "ers-brain");
  assert.equal(config.syncProcess.env.BRAIN_DIR, path.join(brainRoot, "brain"));
  assert.equal(config.cockpitProcess.launchPath, nodePath);
  assert.deepEqual(config.cockpitProcess.arguments, [cockpitScriptPath]);
  assert.equal(config.cockpitProcess.stdoutPath, path.join(logDir, "monitor-cockpit.out.log"));
  assert.equal(config.cockpitProcess.stderrPath, path.join(logDir, "monitor-cockpit.err.log"));
  assert.equal(config.cockpitProcess.env.BRAIN_COCKPIT_PORT, "8798");
  assert.match(source, /NSStatusBar/);
  assert.match(source, /startManagedProcesses/);
  assert.match(source, /syncTaskNameForProfile/);
  assert.match(source, /cockpitTaskNameForProfile/);
  assert.match(source, /writeStackStatus/);
  assert.match(source, /scheduleStackHeartbeat/);
  assert.match(source, /scheduleDoctorPolling/);
  assert.match(source, /doctorPollTimer/);
  assert.match(source, /doctorInitialDelayMs/);
  assert.match(source, /performSelector:@selector\(refreshAllDoctors:\)/);
  assert.match(source, /refreshAllDoctors/);
  assert.match(source, /connectivityStateForDoctorReport/);
  assert.match(source, /Brain Offline/);
  assert.match(source, /setStatusTitle/);
  assert.match(source, /statusColorForTitle/);
  assert.match(source, /NSForegroundColorAttributeName/);
  assert.match(source, /attributedTitle/);
  assert.match(source, /addProfileMenuForProfile/);
  assert.match(source, /NSMenu \*profileMenu/);
  assert.match(source, /\[profileItem setSubmenu:profileMenu\]/);
  assert.match(source, /Overview/);
  assert.match(source, /Actions/);
  assert.match(source, /Controls/);
  assert.match(source, /Diagnostics/);
  assert.match(source, /NSTimer/);
  assert.match(source, /readDoctorReportForProfile/);
  assert.match(source, /actionItemsForDoctorReport/);
  assert.match(source, /Brain Action/);
  assert.match(source, /Action required/);
  assert.match(source, /Open Cockpit for details/);
  assert.match(source, /displayName/);
  assert.match(source, /cockpitUrl/);
  assert.match(source, /Open Cockpit/);
  assert.match(source, /Refresh Doctor/);
  assert.match(source, /Restart Local Stack/);
  assert.match(source, /Open Sync Logs/);
  assert.doesNotMatch(source, /launchctl/);
  assert.match(source, /health\[@"report"\]/);
  assert.match(source, /report\[@"conflicts"\]/);
  assert.notEqual(stat.mode & 0o111, 0);
});

test("menu-bar app can supervise multiple Brain local stacks", async () => {
  const appPath = path.join(tmpRoot, "Applications", "Brain Monitor.app");
  const jemRoot = path.join(tmpRoot, "ai-brain-jem");
  const ersRoot = path.join(tmpRoot, "ers-brain");
  const nodePath = "/opt/example/bin/node";
  const syncCliPath = path.join(tmpRoot, "repo", "dist", "sync", "cli.js");
  const cockpitScriptPath = path.join(tmpRoot, "repo", "scripts", "hosted-cockpit.mjs");
  const profiles = [
    {
      id: "ai-brain-jem",
      name: "JEM",
      brainRoot: jemRoot,
      stateFile: path.join(tmpRoot, "state", "jem", "state.json"),
      healthFile: path.join(tmpRoot, "state", "jem", "state.health.json"),
      logDir: path.join(tmpRoot, "logs", "jem"),
      cockpitUrl: "http://127.0.0.1:8787/",
    },
    {
      id: "ers-brain",
      name: "ERS",
      brainRoot: ersRoot,
      stateFile: path.join(tmpRoot, "state", "ers", "state.json"),
      healthFile: path.join(tmpRoot, "state", "ers", "state.health.json"),
      logDir: path.join(tmpRoot, "logs", "ers"),
      cockpitUrl: "http://127.0.0.1:8788/",
    },
  ];

  const { stdout } = await exec(process.execPath, [menuBarScriptPath], {
    env: {
      ...process.env,
      BRAIN_MENUBAR_APP: appPath,
      BRAIN_MENUBAR_BUNDLE_ID: "com.example.brain-monitor",
      BRAIN_MENUBAR_PROFILES_JSON: JSON.stringify(profiles),
      BRAIN_MENUBAR_NODE: nodePath,
      BRAIN_MENUBAR_SYNC_CLI: syncCliPath,
      BRAIN_MENUBAR_COCKPIT_SCRIPT: cockpitScriptPath,
    },
  });

  const result = JSON.parse(stdout);
  const source = await fs.readFile(
    path.join(appPath, "Contents", "Resources", "brain-menubar-app.m"),
    "utf-8"
  );
  const config = JSON.parse(
    await fs.readFile(
      path.join(appPath, "Contents", "Resources", "brain-menubar-config.json"),
      "utf-8"
    )
  );

  assert.equal(result.brainCount, 2);
  assert.deepEqual(
    result.brainIds,
    ["ai-brain-jem", "ers-brain"]
  );
  assert.equal(config.brains.length, 2);
  assert.equal(config.brains[0].brainId, "ai-brain-jem");
  assert.equal(config.brains[0].displayName, "JEM");
  assert.equal(config.brains[0].brainDir, path.join(jemRoot, "brain"));
  assert.equal(config.brains[0].cockpitProcess.env.BRAIN_COCKPIT_PORT, "8787");
  assert.equal(config.brains[0].syncProcess.env.BRAIN_MONITOR_STACK_FILE, path.join(tmpRoot, "logs", "jem", "brain-monitor-stack.json"));
  assert.equal(config.brains[0].env.BRAIN_PROFILE_NAME, "JEM");
  assert.equal(config.brains[0].env.BRAIN_COCKPIT_URL, "http://127.0.0.1:8787/");
  assert.equal(config.brains[1].brainId, "ers-brain");
  assert.equal(config.brains[1].displayName, "ERS");
  assert.equal(config.brains[1].brainDir, path.join(ersRoot, "brain"));
  assert.equal(config.brains[1].cockpitProcess.env.BRAIN_COCKPIT_PORT, "8788");
  assert.equal(config.brains[1].syncProcess.env.BRAIN_MONITOR_STACK_FILE, path.join(tmpRoot, "logs", "ers", "brain-monitor-stack.json"));
  assert.deepEqual(
    JSON.parse(config.brains[1].env.BRAIN_COCKPIT_PROFILES_JSON).map((profile) => [
      profile.brainId,
      profile.profileName,
      profile.cockpitUrl,
    ]),
    [
      ["ai-brain-jem", "JEM", "http://127.0.0.1:8787/"],
      ["ers-brain", "ERS", "http://127.0.0.1:8788/"],
    ]
  );
  assert.match(source, /for \(NSDictionary \*profile in profiles\)/);
  assert.match(source, /addProfileMenuForProfile:profile toMenu:menu allProfiles:profiles/);
  assert.match(source, /syncTaskNameForProfile/);
  assert.match(source, /cockpitTaskNameForProfile/);
  assert.match(source, /title:@"Open Cockpit" action:@selector\(openCockpit:\) profile:profile/);
  assert.match(source, /Restart All Local Stacks/);
});

test("menu-bar LaunchAgent opens the operator app at login", async () => {
  const outputPath = path.join(tmpRoot, "com.example.ers-brain-monitor.plist");
  const appPath = path.join(tmpRoot, "Applications", "ERS Brain Monitor.app");
  const logDir = path.join(tmpRoot, "logs", "ers-brain");

  const { stdout } = await exec(process.execPath, [menuBarLaunchdScriptPath], {
    env: {
      ...process.env,
      BRAIN_MENUBAR_APP: appPath,
      BRAIN_MENUBAR_LAUNCHD_LABEL: "com.example.ers-brain-monitor",
      BRAIN_MENUBAR_LAUNCHD_PLIST: outputPath,
      BRAIN_MENUBAR_LAUNCHD_LOG_DIR: logDir,
    },
  });

  const result = JSON.parse(stdout);
  const plist = await fs.readFile(outputPath, "utf-8");

  assert.equal(result.outputPath, outputPath);
  assert.equal(result.appPath, appPath);
  assert.equal(result.label, "com.example.ers-brain-monitor");
  assert.match(plist, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/usr\/bin\/open<\/string>\s*<string>-W<\/string>/);
  assert.match(plist, new RegExp(`<string>${appPath}</string>`));
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /<key>LimitLoadToSessionType<\/key>\s*<string>Aqua<\/string>/);
  assert.match(plist, /<key>ProcessType<\/key>\s*<string>Interactive<\/string>/);
  assert.match(plist, new RegExp(`<string>${path.join(logDir, "menubar-launchd.out.log")}</string>`));
  assert.match(plist, new RegExp(`<string>${path.join(logDir, "menubar-launchd.err.log")}</string>`));
});

test("launchd and launcher generators avoid user-specific absolute defaults", async () => {
  const syncGenerator = await fs.readFile(scriptPath, "utf-8");
  const cockpitGenerator = await fs.readFile(cockpitScriptPath, "utf-8");
  const launcherGenerator = await fs.readFile(launcherScriptPath, "utf-8");
  const syncHelperGenerator = await fs.readFile(syncHelperScriptPath, "utf-8");
  const syncHelperLaunchdGenerator = await fs.readFile(syncHelperLaunchdScriptPath, "utf-8");
  const menuBarGenerator = await fs.readFile(menuBarScriptPath, "utf-8");
  const menuBarLaunchdGenerator = await fs.readFile(menuBarLaunchdScriptPath, "utf-8");

  for (const generator of [
    syncGenerator,
    cockpitGenerator,
    launcherGenerator,
    syncHelperGenerator,
    syncHelperLaunchdGenerator,
    menuBarGenerator,
    menuBarLaunchdGenerator,
  ]) {
    assert.doesNotMatch(generator, /\/Users\/johnemilad/);
  }

  assert.match(syncGenerator, /os\.homedir\(\)/);
  assert.match(cockpitGenerator, /os\.homedir\(\)/);
  assert.match(launcherGenerator, /os\.homedir\(\)/);
  assert.match(syncHelperGenerator, /os\.homedir\(\)/);
  assert.match(syncHelperLaunchdGenerator, /os\.homedir\(\)/);
  assert.match(menuBarGenerator, /os\.homedir\(\)/);
  assert.match(menuBarLaunchdGenerator, /os\.homedir\(\)/);
});
