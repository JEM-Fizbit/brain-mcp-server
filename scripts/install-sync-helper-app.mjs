import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const appPath =
  process.env.BRAIN_SYNC_HELPER_APP ||
  path.join(os.homedir(), "Applications", "Brain Sync.app");
const appName = path.basename(appPath, ".app") || "Brain Sync";
const bundleId =
  process.env.BRAIN_SYNC_HELPER_BUNDLE_ID || "com.jem.brain-sync.helper";
const brainRoot =
  process.env.BRAIN_REPO_ROOT || path.join(os.homedir(), "Projects", "ai-brain-jem");
const brainDir = process.env.BRAIN_DIR || path.join(brainRoot, "brain");
const syncDir = path.resolve(brainDir, "..", ".brain-sync");
const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const stateFile = process.env.BRAIN_SYNC_STATE_FILE;
const lockFile = process.env.BRAIN_SYNC_LOCK_FILE;
const healthFile = process.env.BRAIN_SYNC_HEALTH_FILE;
const logDir = process.env.BRAIN_SYNC_LAUNCHD_LOG_DIR || syncDir;
const intervalMs = Number(process.env.BRAIN_SYNC_INTERVAL_MS || 5000);
const nodePath =
  process.env.BRAIN_SYNC_HELPER_NODE ||
  process.env.BRAIN_SYNC_LAUNCHD_NODE ||
  process.execPath;
const syncCliPath =
  process.env.BRAIN_SYNC_HELPER_SYNC_CLI ||
  process.env.BRAIN_SYNC_LAUNCHD_SYNC_CLI ||
  path.join(repoRoot, "dist", "sync", "cli.js");
const contentsDir = path.join(appPath, "Contents");
const macosDir = path.join(contentsDir, "MacOS");
const resourcesDir = path.join(contentsDir, "Resources");
const executablePath = path.join(macosDir, appName);

if (!path.isAbsolute(nodePath)) {
  throw new Error(`BRAIN_SYNC_HELPER_NODE must be absolute: ${nodePath}`);
}

if (!path.isAbsolute(syncCliPath)) {
  throw new Error(`BRAIN_SYNC_HELPER_SYNC_CLI must be absolute: ${syncCliPath}`);
}

if (!Number.isInteger(intervalMs) || intervalMs < 1000) {
  throw new Error(`BRAIN_SYNC_INTERVAL_MS must be an integer >= 1000: ${intervalMs}`);
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

function cString(value) {
  return `"${String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")}"`;
}

const mkdirPaths = [
  logDir,
  stateFile ? path.dirname(stateFile) : null,
  lockFile ? path.dirname(lockFile) : null,
  healthFile ? path.dirname(healthFile) : null,
].filter(Boolean);

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

const stdoutPath = path.join(logDir, "sync-helper.out.log");
const stderrPath = path.join(logDir, "sync-helper.err.log");
const env = {
  BRAIN_ID: brainId,
  BRAIN_DIR: brainDir,
  ...(stateFile ? { BRAIN_SYNC_STATE_FILE: stateFile } : {}),
  ...(lockFile ? { BRAIN_SYNC_LOCK_FILE: lockFile } : {}),
  ...(healthFile ? { BRAIN_SYNC_HEALTH_FILE: healthFile } : {}),
  BRAIN_SYNC_INTERVAL_MS: String(intervalMs),
};
const config = {
  launcherKind: "native",
  repoRoot,
  nodePath,
  syncCliPath,
  args: ["watch"],
  env,
  stdoutPath,
  stderrPath,
};
const nativeSourcePath = path.join(resourcesDir, "sync-helper-launcher.c");
const configPath = path.join(resourcesDir, "sync-helper-config.json");
const cMkdirPaths = mkdirPaths.map((dir) => cString(dir)).join(",\n    ");
const cEnvSetters = Object.entries(env)
  .map(([name, value]) => `  setenv(${cString(name)}, ${cString(value)}, 1);`)
  .join("\n");

const nativeSource = `#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
static pid_t child_pid = -1;

static void forward_signal(int signo) {
  if (child_pid > 0) {
    kill(child_pid, signo);
  }
}

static int mkdir_p(const char *path) {
  char tmp[4096];
  size_t len = strlen(path);

  if (len == 0) {
    return 0;
  }
  if (len >= sizeof(tmp)) {
    errno = ENAMETOOLONG;
    return -1;
  }

  strcpy(tmp, path);
  if (tmp[len - 1] == '/') {
    tmp[len - 1] = '\\0';
  }

  for (char *p = tmp + 1; *p; p++) {
    if (*p == '/') {
      *p = '\\0';
      if (mkdir(tmp, 0755) != 0 && errno != EEXIST) {
        return -1;
      }
      *p = '/';
    }
  }

  if (mkdir(tmp, 0755) != 0 && errno != EEXIST) {
    return -1;
  }
  return 0;
}

int main(void) {
  const char *mkdir_paths[] = {
    ${cMkdirPaths},
    NULL
  };
  const char *repo_root = ${cString(repoRoot)};
  const char *node_path = ${cString(nodePath)};
  const char *sync_cli_path = ${cString(syncCliPath)};
  const char *stdout_path = ${cString(stdoutPath)};
  const char *stderr_path = ${cString(stderrPath)};

  umask(022);
  for (const char **dir = mkdir_paths; *dir != NULL; dir++) {
    if (mkdir_p(*dir) != 0) {
      perror("mkdir_p");
      return 1;
    }
  }

  int out_fd = open(stdout_path, O_CREAT | O_WRONLY | O_APPEND, 0644);
  if (out_fd < 0) {
    perror("open stdout log");
    return 1;
  }
  int err_fd = open(stderr_path, O_CREAT | O_WRONLY | O_APPEND, 0644);
  if (err_fd < 0) {
    perror("open stderr log");
    return 1;
  }

  if (dup2(out_fd, STDOUT_FILENO) < 0 || dup2(err_fd, STDERR_FILENO) < 0) {
    perror("dup2");
    return 1;
  }

  if (chdir(repo_root) != 0) {
    perror("chdir");
    return 1;
  }

${cEnvSetters}

  signal(SIGTERM, forward_signal);
  signal(SIGINT, forward_signal);

  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, out_fd, STDOUT_FILENO);
  posix_spawn_file_actions_adddup2(&actions, err_fd, STDERR_FILENO);
  posix_spawn_file_actions_addclose(&actions, out_fd);
  posix_spawn_file_actions_addclose(&actions, err_fd);

  char *const argv[] = {
    (char *)node_path,
    (char *)sync_cli_path,
    "watch",
    NULL
  };
  int spawn_result = posix_spawn(&child_pid, node_path, &actions, NULL, argv, environ);
  posix_spawn_file_actions_destroy(&actions);

  if (spawn_result != 0) {
    errno = spawn_result;
    perror("posix_spawn");
    return 127;
  }

  int status = 0;
  while (waitpid(child_pid, &status, 0) < 0) {
    if (errno != EINTR) {
      perror("waitpid");
      return 1;
    }
  }

  if (WIFEXITED(status)) {
    return WEXITSTATUS(status);
  }
  if (WIFSIGNALED(status)) {
    return 128 + WTERMSIG(status);
  }
  return 1;
}
`;

await fs.mkdir(macosDir, { recursive: true });
await fs.mkdir(resourcesDir, { recursive: true });
for (const dir of mkdirPaths) {
  await fs.mkdir(dir, { recursive: true });
}
await fs.writeFile(path.join(contentsDir, "Info.plist"), plist, "utf-8");
await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
await fs.writeFile(nativeSourcePath, nativeSource, "utf-8");
await exec("/usr/bin/cc", [
  "-O2",
  "-Wall",
  "-Wextra",
  "-o",
  executablePath,
  nativeSourcePath,
]);
await fs.chmod(executablePath, 0o755);
await exec("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath]);

console.log(
  JSON.stringify(
    {
      appPath,
      executablePath,
      launcherKind: "native",
      signed: true,
      bundleId,
      brainId,
      brainDir,
      stateFile: stateFile || null,
      lockFile: lockFile || null,
      healthFile: healthFile || null,
      logDir,
      intervalMs,
      nodePath,
      syncCliPath,
      note:
        "Grant this app Full Disk Access if the Brain lives under OneDrive/CloudStorage, then launch it.",
    },
    null,
    2
  )
);
