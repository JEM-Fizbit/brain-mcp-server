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
  process.env.BRAIN_MENUBAR_APP ||
  path.join(os.homedir(), "Applications", "Brain Monitor.app");
const appName = path.basename(appPath, ".app") || "Brain Monitor";
const bundleId =
  process.env.BRAIN_MENUBAR_BUNDLE_ID || "com.jem.brain-menubar";
const nodePath =
  process.env.BRAIN_MENUBAR_NODE ||
  process.env.BRAIN_COCKPIT_LAUNCHD_NODE ||
  process.execPath;
const doctorScriptPath =
  process.env.BRAIN_MENUBAR_DOCTOR_SCRIPT ||
  path.join(repoRoot, "scripts", "hosted-doctor.mjs");
const syncCliPath =
  process.env.BRAIN_MENUBAR_SYNC_CLI ||
  process.env.BRAIN_SYNC_HELPER_SYNC_CLI ||
  process.env.BRAIN_SYNC_LAUNCHD_SYNC_CLI ||
  path.join(repoRoot, "dist", "sync", "cli.js");
const cockpitScriptPath =
  process.env.BRAIN_MENUBAR_COCKPIT_SCRIPT ||
  process.env.BRAIN_COCKPIT_LAUNCHD_SCRIPT ||
  path.join(repoRoot, "scripts", "hosted-cockpit.mjs");
const runtimePath =
  process.env.BRAIN_MENUBAR_PATH ||
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const brainRoot =
  process.env.BRAIN_REPO_ROOT || path.join(os.homedir(), "Projects", "ai-brain-jem");
const brainDir = process.env.BRAIN_DIR || path.join(brainRoot, "brain");
const syncDir = path.resolve(brainDir, "..", ".brain-sync");
const brainId = process.env.BRAIN_ID || "ai-brain-jem";
const stateFile = process.env.BRAIN_SYNC_STATE_FILE || path.join(syncDir, "state.json");
const lockFile = process.env.BRAIN_SYNC_LOCK_FILE;
const healthFile = process.env.BRAIN_SYNC_HEALTH_FILE || `${stateFile}.health.json`;
const logDir = process.env.BRAIN_SYNC_LAUNCHD_LOG_DIR || syncDir;
const intervalMs = Number(process.env.BRAIN_SYNC_INTERVAL_MS || 5000);
const syncLaunchdLabel =
  process.env.BRAIN_SYNC_HELPER_LAUNCHD_LABEL ||
  process.env.BRAIN_SYNC_LAUNCHD_LABEL ||
  "com.jem.brain-sync.helper";
const cockpitLaunchdLabel =
  process.env.BRAIN_COCKPIT_LAUNCHD_LABEL || "com.jem.brain-cockpit";
const configuredCockpitUrl = process.env.BRAIN_COCKPIT_URL || "";
let parsedCockpitUrl = null;
try {
  parsedCockpitUrl = configuredCockpitUrl ? new URL(configuredCockpitUrl) : null;
} catch {
  parsedCockpitUrl = null;
}
const cockpitHost =
  process.env.BRAIN_COCKPIT_HOST || parsedCockpitUrl?.hostname || "127.0.0.1";
const cockpitPort = Number(
  process.env.BRAIN_COCKPIT_PORT || parsedCockpitUrl?.port || 8787
);
const cockpitUrl =
  configuredCockpitUrl || `http://${cockpitHost}:${cockpitPort}/`;
const doctorOutputPath =
  process.env.BRAIN_MENUBAR_DOCTOR_OUTPUT ||
  path.join(logDir, "hosted-doctor.out.json");
const doctorErrorPath =
  process.env.BRAIN_MENUBAR_DOCTOR_ERROR ||
  path.join(logDir, "hosted-doctor.err.log");
const stackStatusFile =
  process.env.BRAIN_MONITOR_STACK_FILE ||
  path.join(logDir, "brain-monitor-stack.json");
const syncStdoutPath = path.join(logDir, "monitor-sync.out.log");
const syncStderrPath = path.join(logDir, "monitor-sync.err.log");
const cockpitStdoutPath = path.join(logDir, "monitor-cockpit.out.log");
const cockpitStderrPath = path.join(logDir, "monitor-cockpit.err.log");
const contentsDir = path.join(appPath, "Contents");
const macosDir = path.join(contentsDir, "MacOS");
const resourcesDir = path.join(contentsDir, "Resources");
const executablePath = path.join(macosDir, appName);
const nativeSourcePath = path.join(resourcesDir, "brain-menubar-app.m");
const configPath = path.join(resourcesDir, "brain-menubar-config.json");

function parseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

function normalizeProfile(rawProfile, index) {
  const raw = rawProfile || {};
  const profileBrainRoot =
    raw.brainRoot ||
    raw.brainRepoRoot ||
    (index === 0 ? brainRoot : undefined);
  const profileBrainDir =
    raw.brainDir ||
    (profileBrainRoot ? path.join(profileBrainRoot, "brain") : undefined);
  if (!profileBrainDir) {
    throw new Error(`Brain profile ${index} must include brainRoot or brainDir`);
  }

  const profileSyncDir = path.resolve(profileBrainDir, "..", ".brain-sync");
  const profileBrainId = raw.brainId || raw.id || (index === 0 ? brainId : undefined);
  if (!profileBrainId) {
    throw new Error(`Brain profile ${index} must include id or brainId`);
  }

  const profileStateFile =
    raw.stateFile ||
    raw.syncStateFile ||
    (index === 0 ? stateFile : path.join(profileSyncDir, "state.json"));
  const profileLockFile = raw.lockFile || raw.syncLockFile || undefined;
  const profileHealthFile =
    raw.healthFile ||
    raw.syncHealthFile ||
    (index === 0 ? healthFile : `${profileStateFile}.health.json`);
  const profileLogDir = raw.logDir || (index === 0 ? logDir : profileSyncDir);
  const profileIntervalMs = Number(raw.intervalMs || raw.syncIntervalMs || intervalMs);
  const profileCockpitUrl = raw.cockpitUrl || (index === 0 ? cockpitUrl : "");
  const parsedProfileCockpitUrl = parseUrl(profileCockpitUrl);
  const profileCockpitHost =
    raw.cockpitHost ||
    parsedProfileCockpitUrl?.hostname ||
    (index === 0 ? cockpitHost : "127.0.0.1");
  const profileCockpitPort = Number(
    raw.cockpitPort || parsedProfileCockpitUrl?.port || (index === 0 ? cockpitPort : 8787)
  );
  const resolvedCockpitUrl =
    profileCockpitUrl || `http://${profileCockpitHost}:${profileCockpitPort}/`;
  const profileStackStatusFile =
    raw.stackStatusFile ||
    raw.monitorStackFile ||
    path.join(profileLogDir, "brain-monitor-stack.json");
  const profileDoctorOutputPath =
    raw.doctorOutputPath || path.join(profileLogDir, "hosted-doctor.out.json");
  const profileDoctorErrorPath =
    raw.doctorErrorPath || path.join(profileLogDir, "hosted-doctor.err.log");

  if (!Number.isInteger(profileIntervalMs) || profileIntervalMs < 1000) {
    throw new Error(
      `Brain profile ${profileBrainId} interval must be an integer >= 1000: ${profileIntervalMs}`
    );
  }
  if (
    !Number.isInteger(profileCockpitPort) ||
    profileCockpitPort < 1 ||
    profileCockpitPort > 65535
  ) {
    throw new Error(
      `Brain profile ${profileBrainId} cockpit port must be valid: ${profileCockpitPort}`
    );
  }

  const syncStdout = path.join(profileLogDir, "monitor-sync.out.log");
  const syncStderr = path.join(profileLogDir, "monitor-sync.err.log");
  const cockpitStdout = path.join(profileLogDir, "monitor-cockpit.out.log");
  const cockpitStderr = path.join(profileLogDir, "monitor-cockpit.err.log");
  const baseEnv = {
    BRAIN_ID: profileBrainId,
    BRAIN_DIR: profileBrainDir,
    BRAIN_SYNC_STATE_FILE: profileStateFile,
    ...(profileLockFile ? { BRAIN_SYNC_LOCK_FILE: profileLockFile } : {}),
    BRAIN_SYNC_HEALTH_FILE: profileHealthFile,
    BRAIN_SYNC_SUPERVISOR: "menubar",
    BRAIN_MONITOR_STACK_FILE: profileStackStatusFile,
    PATH: runtimePath,
  };

  return {
    brainId: profileBrainId,
    displayName: raw.displayName || raw.name || profileBrainId,
    brainDir: profileBrainDir,
    stateFile: profileStateFile,
    ...(profileLockFile ? { lockFile: profileLockFile } : {}),
    healthFile: profileHealthFile,
    logDir: profileLogDir,
    cockpitUrl: resolvedCockpitUrl,
    nodePath,
    doctorScriptPath,
    syncCliPath,
    cockpitScriptPath,
    doctorOutputPath: profileDoctorOutputPath,
    doctorErrorPath: profileDoctorErrorPath,
    stackStatusFile: profileStackStatusFile,
    env: baseEnv,
    syncProcess: {
      name: "sync",
      launchPath: nodePath,
      arguments: [syncCliPath, "watch"],
      currentDirectoryPath: repoRoot,
      stdoutPath: syncStdout,
      stderrPath: syncStderr,
      env: {
        ...baseEnv,
        BRAIN_SYNC_INTERVAL_MS: String(profileIntervalMs),
      },
    },
    cockpitProcess: {
      name: "cockpit",
      launchPath: nodePath,
      arguments: [cockpitScriptPath],
      currentDirectoryPath: repoRoot,
      stdoutPath: cockpitStdout,
      stderrPath: cockpitStderr,
      env: {
        ...baseEnv,
        BRAIN_COCKPIT_HOST: profileCockpitHost,
        BRAIN_COCKPIT_PORT: String(profileCockpitPort),
        BRAIN_COCKPIT_PORT_FALLBACK: "0",
      },
    },
  };
}

function readProfiles() {
  if (!process.env.BRAIN_MENUBAR_PROFILES_JSON) {
    return [normalizeProfile({}, 0)];
  }
  let rawProfiles;
  try {
    rawProfiles = JSON.parse(process.env.BRAIN_MENUBAR_PROFILES_JSON);
  } catch (error) {
    throw new Error(`BRAIN_MENUBAR_PROFILES_JSON must be valid JSON: ${error.message}`);
  }
  if (!Array.isArray(rawProfiles) || rawProfiles.length === 0) {
    throw new Error("BRAIN_MENUBAR_PROFILES_JSON must be a non-empty array");
  }
  return rawProfiles.map((profile, index) => normalizeProfile(profile, index));
}

const brainProfiles = readProfiles();
const primaryProfile = brainProfiles[0];

for (const [name, value] of [
  ["BRAIN_MENUBAR_APP", appPath],
  ["BRAIN_MENUBAR_NODE", nodePath],
  ["BRAIN_MENUBAR_DOCTOR_SCRIPT", doctorScriptPath],
  ["BRAIN_MENUBAR_SYNC_CLI", syncCliPath],
  ["BRAIN_MENUBAR_COCKPIT_SCRIPT", cockpitScriptPath],
]) {
  if (value && !path.isAbsolute(value)) {
    throw new Error(`${name} must be absolute: ${value}`);
  }
}

for (const profile of brainProfiles) {
  for (const [name, value] of [
    [`${profile.brainId}.brainDir`, profile.brainDir],
    [`${profile.brainId}.stateFile`, profile.stateFile],
    [`${profile.brainId}.lockFile`, profile.lockFile],
    [`${profile.brainId}.healthFile`, profile.healthFile],
    [`${profile.brainId}.logDir`, profile.logDir],
    [`${profile.brainId}.doctorOutputPath`, profile.doctorOutputPath],
    [`${profile.brainId}.doctorErrorPath`, profile.doctorErrorPath],
    [`${profile.brainId}.stackStatusFile`, profile.stackStatusFile],
  ]) {
    if (value && !path.isAbsolute(value)) {
      throw new Error(`${name} must be absolute: ${value}`);
    }
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
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;

const config = {
  launcherKind: "native_menubar",
  repoRoot,
  brainId: primaryProfile.brainId,
  brainDir: primaryProfile.brainDir,
  stateFile: primaryProfile.stateFile,
  ...(primaryProfile.lockFile ? { lockFile: primaryProfile.lockFile } : {}),
  healthFile: primaryProfile.healthFile,
  logDir: primaryProfile.logDir,
  syncLaunchdLabel,
  cockpitLaunchdLabel,
  cockpitUrl: primaryProfile.cockpitUrl,
  nodePath,
  doctorScriptPath,
  syncCliPath,
  cockpitScriptPath,
  doctorOutputPath: primaryProfile.doctorOutputPath,
  doctorErrorPath: primaryProfile.doctorErrorPath,
  stackStatusFile: primaryProfile.stackStatusFile,
  syncProcess: primaryProfile.syncProcess,
  cockpitProcess: primaryProfile.cockpitProcess,
  env: primaryProfile.env,
  brains: brainProfiles,
};

const nativeSource = `#import <Cocoa/Cocoa.h>
#include <unistd.h>

@interface BrainMenuAppDelegate : NSObject <NSApplicationDelegate>
@property (strong) NSStatusItem *statusItem;
@property (strong) NSDictionary *config;
@property (strong) NSMutableDictionary *managedTasks;
@property (strong) NSMutableDictionary *managedProcessConfigs;
@property (strong) NSMutableSet *intentionalStops;
@property (strong) NSTimer *stackHeartbeatTimer;
@property (copy) NSString *lastAction;
@end

@implementation BrainMenuAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  self.config = [self loadConfig];
  self.managedTasks = [NSMutableDictionary dictionary];
  self.managedProcessConfigs = [NSMutableDictionary dictionary];
  self.intentionalStops = [NSMutableSet set];
  self.lastAction = @"Ready";
  self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
  self.statusItem.button.title = @"Brain";
  [self startManagedProcesses];
  [self scheduleStackHeartbeat];
  [self rebuildMenu:nil];
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  (void)notification;
  [self.stackHeartbeatTimer invalidate];
  [self stopManagedProcesses:nil];
}

- (NSDictionary *)loadConfig {
  NSString *path = [[NSBundle mainBundle] pathForResource:@"brain-menubar-config" ofType:@"json"];
  NSDictionary *fallback = @{
    @"brainId": @"unknown",
    @"cockpitUrl": @"http://127.0.0.1:8787/"
  };
  if (path.length == 0) {
    return fallback;
  }
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data) {
    return fallback;
  }
  id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![json isKindOfClass:[NSDictionary class]]) {
    return fallback;
  }
  return (NSDictionary *)json;
}

- (NSDictionary *)readJsonAtPath:(NSString *)path {
  if (path.length == 0) {
    return nil;
  }
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data) {
    return nil;
  }
  id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![json isKindOfClass:[NSDictionary class]]) {
    return nil;
  }
  return (NSDictionary *)json;
}

- (NSString *)stringConfig:(NSString *)key fallback:(NSString *)fallback {
  id value = self.config[key];
  if ([value isKindOfClass:[NSString class]] && [value length] > 0) {
    return (NSString *)value;
  }
  return fallback;
}

- (NSDictionary *)dictionaryConfig:(NSString *)key {
  id value = self.config[key];
  if ([value isKindOfClass:[NSDictionary class]]) {
    return (NSDictionary *)value;
  }
  return nil;
}

- (NSArray *)brainProfiles {
  id profiles = self.config[@"brains"];
  if ([profiles isKindOfClass:[NSArray class]] && [profiles count] > 0) {
    return (NSArray *)profiles;
  }
  return @[self.config];
}

- (NSDictionary *)firstBrainProfile {
  NSArray *profiles = [self brainProfiles];
  return profiles.count > 0 && [profiles[0] isKindOfClass:[NSDictionary class]]
    ? (NSDictionary *)profiles[0]
    : self.config;
}

- (NSString *)brainIdForProfile:(NSDictionary *)profile {
  return [self stringFromValue:profile[@"brainId"] fallback:@"unknown"];
}

- (NSString *)displayNameForProfile:(NSDictionary *)profile {
  NSString *displayName = [self stringFromValue:profile[@"displayName"] fallback:nil];
  return displayName.length > 0 ? displayName : [self brainIdForProfile:profile];
}

- (NSString *)syncTaskNameForProfile:(NSDictionary *)profile {
  return [NSString stringWithFormat:@"sync:%@", [self brainIdForProfile:profile]];
}

- (NSString *)cockpitTaskNameForProfile:(NSDictionary *)profile {
  return [NSString stringWithFormat:@"cockpit:%@", [self brainIdForProfile:profile]];
}

- (NSDictionary *)profileForBrainId:(NSString *)brainId {
  for (NSDictionary *profile in [self brainProfiles]) {
    if ([[self brainIdForProfile:profile] isEqualToString:brainId]) {
      return profile;
    }
  }
  return [self firstBrainProfile];
}

- (NSDictionary *)profileForSender:(id)sender {
  if ([sender respondsToSelector:@selector(representedObject)]) {
    id representedObject = [sender representedObject];
    if ([representedObject isKindOfClass:[NSString class]]) {
      return [self profileForBrainId:(NSString *)representedObject];
    }
  }
  return [self firstBrainProfile];
}

- (NSString *)actionTitle:(NSString *)singleTitle multiFormat:(NSString *)multiFormat profile:(NSDictionary *)profile {
  if ([self brainProfiles].count <= 1) {
    return singleTitle;
  }
  return [NSString stringWithFormat:multiFormat, [self displayNameForProfile:profile]];
}

- (NSString *)stringFromValue:(id)value fallback:(NSString *)fallback {
  if ([value isKindOfClass:[NSString class]] && [value length] > 0) {
    return (NSString *)value;
  }
  if ([value respondsToSelector:@selector(stringValue)]) {
    return [value stringValue];
  }
  return fallback;
}

- (NSString *)healthStatusFrom:(NSDictionary *)health {
  NSString *status = [self stringFromValue:health[@"status"] fallback:nil];
  if (status.length == 0) {
    status = [self stringFromValue:health[@"overallStatus"] fallback:nil];
  }
  if (status.length == 0) {
    status = health ? @"unknown" : @"missing";
  }
  return [status lowercaseString];
}

- (NSString *)statusTitleForHealth:(NSDictionary *)health {
  NSString *status = [self healthStatusFrom:health];
  if ([status isEqualToString:@"ok"] || [status isEqualToString:@"pass"]) {
    return @"Brain OK";
  }
  if ([status isEqualToString:@"warn"] || [status isEqualToString:@"warning"]) {
    return @"Brain Warn";
  }
  if ([status isEqualToString:@"fail"] || [status isEqualToString:@"error"]) {
    return @"Brain Fail";
  }
  return @"Brain";
}

- (void)addDisabledItem:(NSMenu *)menu title:(NSString *)title {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
  item.enabled = NO;
  [menu addItem:item];
}

- (BOOL)isTaskRunningNamed:(NSString *)name {
  NSTask *task = self.managedTasks[name];
  return task && task.isRunning;
}

- (NSDictionary *)statusForManagedTask:(NSString *)name {
  NSTask *task = self.managedTasks[name];
  BOOL running = task && task.isRunning;
  return @{
    @"state": running ? @"running" : @"stopped",
    @"pid": running ? @(task.processIdentifier) : [NSNull null]
  };
}

- (void)writeStackStatus {
  NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
  for (NSDictionary *profile in [self brainProfiles]) {
    NSString *path = [self stringFromValue:profile[@"stackStatusFile"] fallback:@""];
    if (path.length == 0) {
      continue;
    }
    NSDictionary *status = @{
      @"supervisor": @"menubar",
      @"brainId": [self brainIdForProfile:profile],
      @"checkedAt": [formatter stringFromDate:[NSDate date]],
      @"sync": [self statusForManagedTask:[self syncTaskNameForProfile:profile]],
      @"cockpit": [self statusForManagedTask:[self cockpitTaskNameForProfile:profile]]
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:status options:NSJSONWritingPrettyPrinted error:nil];
    if (!data) {
      continue;
    }

    [self ensureParentDirectoryForPath:path];
    [data writeToFile:path atomically:YES];
  }
}

- (void)heartbeatStackStatus:(NSTimer *)timer {
  (void)timer;
  [self writeStackStatus];
}

- (void)scheduleStackHeartbeat {
  [self.stackHeartbeatTimer invalidate];
  self.stackHeartbeatTimer = [NSTimer timerWithTimeInterval:30.0
                                                     target:self
                                                   selector:@selector(heartbeatStackStatus:)
                                                   userInfo:nil
                                                    repeats:YES];
  [[NSRunLoop mainRunLoop] addTimer:self.stackHeartbeatTimer forMode:NSRunLoopCommonModes];
}

- (void)startManagedProcesses {
  [self.intentionalStops removeAllObjects];
  for (NSDictionary *profile in [self brainProfiles]) {
    [self startManagedProcessesForProfile:profile];
  }
  [self writeStackStatus];
}

- (void)startManagedProcessesForProfile:(NSDictionary *)profile {
  [self startManagedProcess:[self syncTaskNameForProfile:profile] processConfig:profile[@"syncProcess"]];
  [self startManagedProcess:[self cockpitTaskNameForProfile:profile] processConfig:profile[@"cockpitProcess"]];
}

- (void)startManagedProcess:(NSString *)name processConfig:(NSDictionary *)processConfig {
  if ([self isTaskRunningNamed:name]) {
    return;
  }

  if (![processConfig isKindOfClass:[NSDictionary class]]) {
    return;
  }
  self.managedProcessConfigs[name] = processConfig;
  NSString *launchPath = [self stringFromValue:processConfig[@"launchPath"] fallback:@""];
  NSArray *arguments = [processConfig[@"arguments"] isKindOfClass:[NSArray class]]
    ? processConfig[@"arguments"]
    : @[];
  NSString *currentDirectoryPath = [self stringFromValue:processConfig[@"currentDirectoryPath"] fallback:@""];
  NSString *stdoutPath = [self stringFromValue:processConfig[@"stdoutPath"] fallback:@""];
  NSString *stderrPath = [self stringFromValue:processConfig[@"stderrPath"] fallback:@""];
  if (launchPath.length == 0 || stdoutPath.length == 0 || stderrPath.length == 0) {
    self.lastAction = [NSString stringWithFormat:@"%@ config missing", name];
    [self writeStackStatus];
    return;
  }

  [self ensureParentDirectoryForPath:stdoutPath];
  [self ensureParentDirectoryForPath:stderrPath];
  [[NSFileManager defaultManager] createFileAtPath:stdoutPath contents:nil attributes:nil];
  [[NSFileManager defaultManager] createFileAtPath:stderrPath contents:nil attributes:nil];
  NSFileHandle *stdoutHandle = [NSFileHandle fileHandleForWritingAtPath:stdoutPath];
  NSFileHandle *stderrHandle = [NSFileHandle fileHandleForWritingAtPath:stderrPath];
  if (!stdoutHandle || !stderrHandle) {
    self.lastAction = [NSString stringWithFormat:@"%@ log open failed", name];
    [self writeStackStatus];
    return;
  }
  [stdoutHandle seekToEndOfFile];
  [stderrHandle seekToEndOfFile];

  NSTask *task = [[NSTask alloc] init];
  task.launchPath = launchPath;
  task.arguments = arguments;
  if (currentDirectoryPath.length > 0) {
    task.currentDirectoryPath = currentDirectoryPath;
  }
  NSMutableDictionary *environment = [[[NSProcessInfo processInfo] environment] mutableCopy];
  NSDictionary *configuredEnv = processConfig[@"env"];
  if ([configuredEnv isKindOfClass:[NSDictionary class]]) {
    for (NSString *key in configuredEnv) {
      id value = configuredEnv[key];
      if ([key isKindOfClass:[NSString class]] && [value isKindOfClass:[NSString class]]) {
        environment[key] = value;
      }
    }
  }
  task.environment = environment;
  task.standardOutput = stdoutHandle;
  task.standardError = stderrHandle;

  __weak typeof(self) weakSelf = self;
  task.terminationHandler = ^(NSTask *finishedTask) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [weakSelf.managedTasks removeObjectForKey:name];
      [weakSelf writeStackStatus];
      if (![weakSelf.intentionalStops containsObject:name]) {
        weakSelf.lastAction = [NSString stringWithFormat:@"%@ exited %d; restarting", name, finishedTask.terminationStatus];
        [weakSelf performSelector:@selector(restartManagedProcessNamed:) withObject:name afterDelay:3.0];
      }
      [weakSelf rebuildMenu:nil];
    });
  };

  @try {
    [task launch];
    self.managedTasks[name] = task;
    self.lastAction = [NSString stringWithFormat:@"%@ running", name];
  } @catch (NSException *exception) {
    self.lastAction = [NSString stringWithFormat:@"%@ failed: %@", name, exception.name];
  }
  [self writeStackStatus];
}

- (void)restartManagedProcessNamed:(NSString *)name {
  NSDictionary *processConfig = self.managedProcessConfigs[name];
  if (processConfig) {
    [self startManagedProcess:name processConfig:processConfig];
  }
  [self rebuildMenu:nil];
}

- (void)stopManagedProcesses:(id)sender {
  (void)sender;
  [self.intentionalStops addObjectsFromArray:@[@"sync", @"cockpit"]];
  for (NSString *name in [self.managedTasks allKeys]) {
    NSTask *task = self.managedTasks[name];
    if (task.isRunning) {
      [task terminate];
    }
  }
  self.lastAction = @"Local stack stopping";
  [self writeStackStatus];
}

- (void)stopManagedProcessesForProfile:(NSDictionary *)profile {
  [self.intentionalStops addObject:[self syncTaskNameForProfile:profile]];
  [self.intentionalStops addObject:[self cockpitTaskNameForProfile:profile]];
  for (NSString *name in @[[self syncTaskNameForProfile:profile], [self cockpitTaskNameForProfile:profile]]) {
    NSTask *task = self.managedTasks[name];
    if (task.isRunning) {
      [task terminate];
    }
  }
  [self writeStackStatus];
}

- (void)restartLocalStack:(id)sender {
  NSDictionary *profile = [self profileForSender:sender];
  [self stopManagedProcessesForProfile:profile];
  [self performSelector:@selector(startLocalStackAfterStop:) withObject:[self brainIdForProfile:profile] afterDelay:2.0];
}

- (void)restartAllLocalStacks:(id)sender {
  (void)sender;
  [self stopManagedProcesses:nil];
  [self performSelector:@selector(startLocalStackAfterStop:) withObject:nil afterDelay:2.0];
}

- (void)startLocalStackAfterStop:(id)sender {
  if ([sender isKindOfClass:[NSString class]]) {
    NSDictionary *profile = [self profileForBrainId:(NSString *)sender];
    [self.intentionalStops removeObject:[self syncTaskNameForProfile:profile]];
    [self.intentionalStops removeObject:[self cockpitTaskNameForProfile:profile]];
    [self startManagedProcessesForProfile:profile];
    self.lastAction = [NSString stringWithFormat:@"%@ stack restarted", [self displayNameForProfile:profile]];
  } else {
    [self startManagedProcesses];
    self.lastAction = @"All local stacks restarted";
  }
  [self rebuildMenu:nil];
}

- (NSString *)statusTitleForProfiles {
  BOOL sawWarn = NO;
  BOOL sawKnown = NO;
  for (NSDictionary *profile in [self brainProfiles]) {
    NSDictionary *health = [self readJsonAtPath:[self stringFromValue:profile[@"healthFile"] fallback:@""]];
    NSString *status = [self healthStatusFrom:health];
    if ([status isEqualToString:@"fail"] || [status isEqualToString:@"error"]) {
      return @"Brain Fail";
    }
    if ([status isEqualToString:@"warn"] || [status isEqualToString:@"warning"] || [status isEqualToString:@"missing"]) {
      sawWarn = YES;
    }
    if ([status isEqualToString:@"ok"] || [status isEqualToString:@"pass"]) {
      sawKnown = YES;
    }
  }
  if (sawWarn) {
    return @"Brain Warn";
  }
  return sawKnown ? @"Brain OK" : @"Brain";
}

- (void)addActionItem:(NSMenu *)menu title:(NSString *)title action:(SEL)action profile:(NSDictionary *)profile {
  NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:@""];
  item.target = self;
  item.representedObject = [self brainIdForProfile:profile];
  [menu addItem:item];
}

- (void)rebuildMenu:(id)sender {
  (void)sender;
  NSArray *profiles = [self brainProfiles];
  self.statusItem.button.title = [self statusTitleForProfiles];

  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Brain Monitor"];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Brains: %lu", (unsigned long)profiles.count]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Last action: %@", self.lastAction ?: @"Ready"]];
  [menu addItem:[NSMenuItem separatorItem]];

  for (NSDictionary *profile in [self brainProfiles]) {
    NSString *displayName = [self displayNameForProfile:profile];
    NSDictionary *health = [self readJsonAtPath:[self stringFromValue:profile[@"healthFile"] fallback:@""]];
    NSDictionary *report = nil;
    id reportValue = health[@"report"];
    if ([reportValue isKindOfClass:[NSDictionary class]]) {
      report = (NSDictionary *)reportValue;
    }
    NSString *status = [self healthStatusFrom:health];
    NSString *checkedAt = [self stringFromValue:health[@"checkedAt"] fallback:nil];
    if (checkedAt.length == 0) {
      checkedAt = [self stringFromValue:health[@"lastCheckedAt"] fallback:nil];
    }
    if (checkedAt.length == 0) {
      checkedAt = [self stringFromValue:health[@"updatedAt"] fallback:@"not reported"];
    }
    NSString *lastSyncAt = [self stringFromValue:health[@"lastSyncAt"] fallback:nil];
    if (lastSyncAt.length == 0) {
      lastSyncAt = [self stringFromValue:health[@"lastSuccessfulSyncAt"] fallback:nil];
    }
    if (lastSyncAt.length == 0) {
      lastSyncAt = checkedAt.length > 0 ? checkedAt : @"not reported";
    }
    NSString *conflicts = [self stringFromValue:health[@"openConflicts"] fallback:nil];
    if (conflicts.length == 0) {
      conflicts = [self stringFromValue:health[@"conflicts"] fallback:nil];
    }
    if (conflicts.length == 0) {
      conflicts = [self stringFromValue:report[@"conflicts"] fallback:nil];
    }
    if (conflicts.length == 0) {
      conflicts = [self stringFromValue:health[@"openConflictCount"] fallback:@"not reported"];
    }
    NSString *cycle = [self stringFromValue:health[@"cycle"] fallback:@"not reported"];
    NSString *durationMs = [self stringFromValue:report[@"totalMs"] fallback:nil];
    NSString *duration = durationMs.length > 0 ? [NSString stringWithFormat:@"%@ms", durationMs] : @"not reported";
    NSString *pushed = [self stringFromValue:report[@"pushed"] fallback:@"not reported"];
    NSString *pulled = [self stringFromValue:report[@"pulled"] fallback:@"not reported"];
    NSString *unchanged = [self stringFromValue:report[@"unchanged"] fallback:@"not reported"];
    NSString *syncState = [self isTaskRunningNamed:[self syncTaskNameForProfile:profile]] ? @"running" : @"stopped";
    NSString *cockpitState = [self isTaskRunningNamed:[self cockpitTaskNameForProfile:profile]] ? @"running" : @"stopped";

    [self addDisabledItem:menu title:[NSString stringWithFormat:@"%@: %@", displayName, status]];
    [self addDisabledItem:menu title:[NSString stringWithFormat:@"Last check: %@", checkedAt]];
    [self addDisabledItem:menu title:[NSString stringWithFormat:@"Last sync: %@", lastSyncAt]];
    [self addDisabledItem:menu title:[NSString stringWithFormat:@"Cycle: %@ (%@)", cycle, duration]];
    [self addDisabledItem:menu title:[NSString stringWithFormat:@"Changes: +%@ / -%@ / same %@", pushed, pulled, unchanged]];
    [self addDisabledItem:menu title:[NSString stringWithFormat:@"Open conflicts: %@", conflicts]];
    [self addDisabledItem:menu title:[NSString stringWithFormat:@"Local stack: sync %@ / cockpit %@", syncState, cockpitState]];

    [self addActionItem:menu
                  title:[self actionTitle:@"Refresh Doctor" multiFormat:@"Refresh %@ Doctor" profile:profile]
                 action:@selector(refreshDoctor:)
                profile:profile];
    [self addActionItem:menu
                  title:[self actionTitle:@"Open Cockpit" multiFormat:@"Open %@ Cockpit" profile:profile]
                 action:@selector(openCockpit:)
                profile:profile];
    [self addActionItem:menu
                  title:[self actionTitle:@"Open Sync Logs" multiFormat:@"Open %@ Sync Logs" profile:profile]
                 action:@selector(openLogs:)
                profile:profile];
    [self addActionItem:menu
                  title:[self actionTitle:@"Restart Local Stack" multiFormat:@"Restart %@ Local Stack" profile:profile]
                 action:@selector(restartLocalStack:)
                profile:profile];
    [menu addItem:[NSMenuItem separatorItem]];
  }

  NSMenuItem *refresh = [[NSMenuItem alloc] initWithTitle:@"Refresh Status" action:@selector(rebuildMenu:) keyEquivalent:@""];
  refresh.target = self;
  [menu addItem:refresh];

  if (profiles.count > 1) {
    NSMenuItem *restartAll = [[NSMenuItem alloc] initWithTitle:@"Restart All Local Stacks" action:@selector(restartAllLocalStacks:) keyEquivalent:@""];
    restartAll.target = self;
    [menu addItem:restartAll];
  }

  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:@"Quit Brain Monitor" action:@selector(terminate:) keyEquivalent:@"q"];
  quit.target = NSApp;
  [menu addItem:quit];

  self.statusItem.menu = menu;
}

- (void)openCockpit:(id)sender {
  NSDictionary *profile = [self profileForSender:sender];
  [self startManagedProcess:[self cockpitTaskNameForProfile:profile] processConfig:profile[@"cockpitProcess"]];
  NSString *urlString = [self stringFromValue:profile[@"cockpitUrl"] fallback:@"http://127.0.0.1:8787/"];
  NSURL *url = [NSURL URLWithString:urlString];
  if (url) {
    [[NSWorkspace sharedWorkspace] openURL:url];
    self.lastAction = [NSString stringWithFormat:@"Opened %@ cockpit", [self displayNameForProfile:profile]];
  } else {
    self.lastAction = @"Invalid cockpit URL";
  }
  [self rebuildMenu:nil];
}

- (void)openLogs:(id)sender {
  NSDictionary *profile = [self profileForSender:sender];
  NSString *logDir = [self stringFromValue:profile[@"logDir"] fallback:@""];
  if (logDir.length > 0) {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:logDir isDirectory:YES]];
    self.lastAction = [NSString stringWithFormat:@"Opened %@ logs", [self displayNameForProfile:profile]];
  } else {
    self.lastAction = @"No log directory configured";
  }
  [self rebuildMenu:nil];
}

- (void)refreshDoctor:(id)sender {
  [self runDoctorTaskForProfile:[self profileForSender:sender]];
  [self rebuildMenu:nil];
}

- (void)runDoctorTaskForProfile:(NSDictionary *)profile {
  NSString *nodePath = [self stringFromValue:profile[@"nodePath"] fallback:[self stringConfig:@"nodePath" fallback:@""]];
  NSString *profileDoctorScriptPath = [self stringFromValue:profile[@"doctorScriptPath"] fallback:[self stringConfig:@"doctorScriptPath" fallback:@""]];
  NSString *repoRoot = [self stringConfig:@"repoRoot" fallback:@""];
  NSString *outputPath = [self stringFromValue:profile[@"doctorOutputPath"] fallback:@""];
  NSString *errorPath = [self stringFromValue:profile[@"doctorErrorPath"] fallback:@""];
  if (nodePath.length == 0 || profileDoctorScriptPath.length == 0 || outputPath.length == 0 || errorPath.length == 0) {
    self.lastAction = @"Doctor config missing";
    return;
  }

  [self ensureParentDirectoryForPath:outputPath];
  [self ensureParentDirectoryForPath:errorPath];
  [[NSFileManager defaultManager] createFileAtPath:outputPath contents:nil attributes:nil];
  [[NSFileManager defaultManager] createFileAtPath:errorPath contents:nil attributes:nil];
  NSFileHandle *stdoutHandle = [NSFileHandle fileHandleForWritingAtPath:outputPath];
  NSFileHandle *stderrHandle = [NSFileHandle fileHandleForWritingAtPath:errorPath];
  if (!stdoutHandle || !stderrHandle) {
    self.lastAction = @"Doctor log open failed";
    return;
  }
  [stdoutHandle truncateFileAtOffset:0];
  [stderrHandle truncateFileAtOffset:0];

  NSTask *task = [[NSTask alloc] init];
  task.launchPath = nodePath;
  task.arguments = @[profileDoctorScriptPath];
  if (repoRoot.length > 0) {
    task.currentDirectoryPath = repoRoot;
  }
  NSMutableDictionary *environment = [[[NSProcessInfo processInfo] environment] mutableCopy];
  NSDictionary *configuredEnv = profile[@"env"];
  if ([configuredEnv isKindOfClass:[NSDictionary class]]) {
    for (NSString *key in configuredEnv) {
      id value = configuredEnv[key];
      if ([key isKindOfClass:[NSString class]] && [value isKindOfClass:[NSString class]]) {
        environment[key] = value;
      }
    }
  }
  task.environment = environment;
  task.standardOutput = stdoutHandle;
  task.standardError = stderrHandle;
  __weak typeof(self) weakSelf = self;
  NSString *displayName = [self displayNameForProfile:profile];
  task.terminationHandler = ^(NSTask *finishedTask) {
    dispatch_async(dispatch_get_main_queue(), ^{
      weakSelf.lastAction = [NSString stringWithFormat:@"%@ doctor exited %d", displayName, finishedTask.terminationStatus];
      [weakSelf rebuildMenu:nil];
    });
  };

  @try {
    [task launch];
    self.lastAction = [NSString stringWithFormat:@"%@ doctor running", displayName];
  } @catch (NSException *exception) {
    self.lastAction = [NSString stringWithFormat:@"Doctor failed: %@", exception.name];
  }
}

- (void)ensureParentDirectoryForPath:(NSString *)filePath {
  NSString *dir = [filePath stringByDeletingLastPathComponent];
  if (dir.length > 0) {
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  }
}

@end

int main(int argc, const char *argv[]) {
  (void)argc;
  (void)argv;
  @autoreleasepool {
    NSApplication *app = [NSApplication sharedApplication];
    BrainMenuAppDelegate *delegate = [[BrainMenuAppDelegate alloc] init];
    app.delegate = delegate;
    [app run];
  }
  return 0;
}
`;

await fs.mkdir(macosDir, { recursive: true });
await fs.mkdir(resourcesDir, { recursive: true });
for (const profile of brainProfiles) {
  await fs.mkdir(profile.logDir, { recursive: true });
  await fs.mkdir(path.dirname(profile.stateFile), { recursive: true });
  await fs.mkdir(path.dirname(profile.healthFile), { recursive: true });
  await fs.mkdir(path.dirname(profile.stackStatusFile), { recursive: true });
  await fs.mkdir(path.dirname(profile.doctorOutputPath), { recursive: true });
  await fs.mkdir(path.dirname(profile.doctorErrorPath), { recursive: true });
}
await fs.writeFile(path.join(contentsDir, "Info.plist"), plist, "utf-8");
await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
await fs.writeFile(nativeSourcePath, nativeSource, "utf-8");
await exec("/usr/bin/cc", [
  "-fobjc-arc",
  "-O2",
  "-Wall",
  "-Wextra",
  "-framework",
  "Cocoa",
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
      launcherKind: "native_menubar",
      signed: true,
      bundleId,
      brainId: primaryProfile.brainId,
      brainIds: brainProfiles.map((profile) => profile.brainId),
      brainCount: brainProfiles.length,
      brainDir: primaryProfile.brainDir,
      stateFile: primaryProfile.stateFile,
      healthFile: primaryProfile.healthFile,
      logDir: primaryProfile.logDir,
      syncLaunchdLabel,
      cockpitLaunchdLabel,
      cockpitUrl: primaryProfile.cockpitUrl,
      nodePath,
      doctorScriptPath,
      doctorOutputPath: primaryProfile.doctorOutputPath,
      doctorErrorPath: primaryProfile.doctorErrorPath,
      note:
        "Launch the app to show Brain status in the macOS menu bar. It supervises configured local sync watchers and cockpit servers, opens logs, restarts local stacks, and refreshes hosted doctor output.",
    },
    null,
    2
  )
);
