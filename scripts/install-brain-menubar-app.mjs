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
const runtimePath =
  process.env.BRAIN_MENUBAR_PATH ||
  "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const contentsDir = path.join(appPath, "Contents");
const macosDir = path.join(contentsDir, "MacOS");
const resourcesDir = path.join(contentsDir, "Resources");
const executablePath = path.join(macosDir, appName);
const nativeSourcePath = path.join(resourcesDir, "brain-menubar-app.m");
const configPath = path.join(resourcesDir, "brain-menubar-config.json");

for (const [name, value] of [
  ["BRAIN_MENUBAR_APP", appPath],
  ["BRAIN_DIR", brainDir],
  ["BRAIN_SYNC_STATE_FILE", stateFile],
  ["BRAIN_SYNC_LOCK_FILE", lockFile],
  ["BRAIN_SYNC_HEALTH_FILE", healthFile],
  ["BRAIN_SYNC_LAUNCHD_LOG_DIR", logDir],
  ["BRAIN_MENUBAR_NODE", nodePath],
  ["BRAIN_MENUBAR_DOCTOR_SCRIPT", doctorScriptPath],
  ["BRAIN_MENUBAR_SYNC_CLI", syncCliPath],
  ["BRAIN_MENUBAR_COCKPIT_SCRIPT", cockpitScriptPath],
  ["BRAIN_MENUBAR_DOCTOR_OUTPUT", doctorOutputPath],
  ["BRAIN_MENUBAR_DOCTOR_ERROR", doctorErrorPath],
  ["BRAIN_MONITOR_STACK_FILE", stackStatusFile],
]) {
  if (value && !path.isAbsolute(value)) {
    throw new Error(`${name} must be absolute: ${value}`);
  }
}

if (!Number.isInteger(intervalMs) || intervalMs < 1000) {
  throw new Error(`BRAIN_SYNC_INTERVAL_MS must be an integer >= 1000: ${intervalMs}`);
}

if (!Number.isInteger(cockpitPort) || cockpitPort < 1 || cockpitPort > 65535) {
  throw new Error(`BRAIN_COCKPIT_PORT must be a valid TCP port: ${cockpitPort}`);
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
  brainId,
  brainDir,
  stateFile,
  healthFile,
  logDir,
  syncLaunchdLabel,
  cockpitLaunchdLabel,
  cockpitUrl,
  nodePath,
  doctorScriptPath,
  syncCliPath,
  cockpitScriptPath,
  doctorOutputPath,
  doctorErrorPath,
  stackStatusFile,
  syncProcess: {
    name: "sync",
    launchPath: nodePath,
    arguments: [syncCliPath, "watch"],
    currentDirectoryPath: repoRoot,
    stdoutPath: syncStdoutPath,
    stderrPath: syncStderrPath,
    env: {
      BRAIN_ID: brainId,
      BRAIN_DIR: brainDir,
      BRAIN_SYNC_STATE_FILE: stateFile,
      ...(lockFile ? { BRAIN_SYNC_LOCK_FILE: lockFile } : {}),
      BRAIN_SYNC_HEALTH_FILE: healthFile,
      BRAIN_SYNC_INTERVAL_MS: String(intervalMs),
      BRAIN_SYNC_SUPERVISOR: "menubar",
      BRAIN_MONITOR_STACK_FILE: stackStatusFile,
      PATH: runtimePath,
    },
  },
  cockpitProcess: {
    name: "cockpit",
    launchPath: nodePath,
    arguments: [cockpitScriptPath],
    currentDirectoryPath: repoRoot,
    stdoutPath: cockpitStdoutPath,
    stderrPath: cockpitStderrPath,
    env: {
      BRAIN_ID: brainId,
      BRAIN_DIR: brainDir,
      BRAIN_SYNC_STATE_FILE: stateFile,
      ...(lockFile ? { BRAIN_SYNC_LOCK_FILE: lockFile } : {}),
      BRAIN_SYNC_HEALTH_FILE: healthFile,
      BRAIN_SYNC_SUPERVISOR: "menubar",
      BRAIN_MONITOR_STACK_FILE: stackStatusFile,
      BRAIN_COCKPIT_HOST: cockpitHost,
      BRAIN_COCKPIT_PORT: String(cockpitPort),
      BRAIN_COCKPIT_PORT_FALLBACK: "0",
      PATH: runtimePath,
    },
  },
  env: {
    BRAIN_ID: brainId,
    BRAIN_DIR: brainDir,
    BRAIN_SYNC_STATE_FILE: stateFile,
    ...(lockFile ? { BRAIN_SYNC_LOCK_FILE: lockFile } : {}),
    BRAIN_SYNC_HEALTH_FILE: healthFile,
    BRAIN_SYNC_SUPERVISOR: "menubar",
    BRAIN_MONITOR_STACK_FILE: stackStatusFile,
    PATH: runtimePath,
  },
};

const nativeSource = `#import <Cocoa/Cocoa.h>
#include <unistd.h>

@interface BrainMenuAppDelegate : NSObject <NSApplicationDelegate>
@property (strong) NSStatusItem *statusItem;
@property (strong) NSDictionary *config;
@property (strong) NSMutableDictionary *managedTasks;
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
  NSString *path = [self stringConfig:@"stackStatusFile" fallback:@""];
  if (path.length == 0) {
    return;
  }

  NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
  NSDictionary *status = @{
    @"supervisor": @"menubar",
    @"checkedAt": [formatter stringFromDate:[NSDate date]],
    @"sync": [self statusForManagedTask:@"sync"],
    @"cockpit": [self statusForManagedTask:@"cockpit"]
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:status options:NSJSONWritingPrettyPrinted error:nil];
  if (!data) {
    return;
  }

  [self ensureParentDirectoryForPath:path];
  [data writeToFile:path atomically:YES];
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
  [self startManagedProcess:@"sync" configKey:@"syncProcess"];
  [self startManagedProcess:@"cockpit" configKey:@"cockpitProcess"];
  [self writeStackStatus];
}

- (void)startManagedProcess:(NSString *)name configKey:(NSString *)configKey {
  if ([self isTaskRunningNamed:name]) {
    return;
  }

  NSDictionary *processConfig = [self dictionaryConfig:configKey];
  if (!processConfig) {
    return;
  }
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
  if ([name isEqualToString:@"sync"]) {
    [self startManagedProcess:@"sync" configKey:@"syncProcess"];
  } else if ([name isEqualToString:@"cockpit"]) {
    [self startManagedProcess:@"cockpit" configKey:@"cockpitProcess"];
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

- (void)restartLocalStack:(id)sender {
  (void)sender;
  [self stopManagedProcesses:nil];
  [self performSelector:@selector(startLocalStackAfterStop:) withObject:nil afterDelay:2.0];
}

- (void)startLocalStackAfterStop:(id)sender {
  (void)sender;
  [self startManagedProcesses];
  self.lastAction = @"Local stack restarted";
  [self rebuildMenu:nil];
}

- (void)rebuildMenu:(id)sender {
  (void)sender;
  NSString *brainId = [self stringConfig:@"brainId" fallback:@"unknown"];
  NSString *healthFile = [self stringConfig:@"healthFile" fallback:@""];
  NSDictionary *health = [self readJsonAtPath:healthFile];
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
  NSString *syncState = [self isTaskRunningNamed:@"sync"] ? @"running" : @"stopped";
  NSString *cockpitState = [self isTaskRunningNamed:@"cockpit"] ? @"running" : @"stopped";

  self.statusItem.button.title = [self statusTitleForHealth:health];

  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Brain Monitor"];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Brain: %@", brainId]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Status: %@", status]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Last check: %@", checkedAt]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Last sync: %@", lastSyncAt]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Cycle: %@ (%@)", cycle, duration]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Changes: +%@ / -%@ / same %@", pushed, pulled, unchanged]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Open conflicts: %@", conflicts]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Local stack: sync %@ / cockpit %@", syncState, cockpitState]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Last action: %@", self.lastAction ?: @"Ready"]];
  [menu addItem:[NSMenuItem separatorItem]];

  NSMenuItem *refresh = [[NSMenuItem alloc] initWithTitle:@"Refresh Status" action:@selector(rebuildMenu:) keyEquivalent:@""];
  refresh.target = self;
  [menu addItem:refresh];

  NSMenuItem *doctor = [[NSMenuItem alloc] initWithTitle:@"Refresh Doctor" action:@selector(refreshDoctor:) keyEquivalent:@""];
  doctor.target = self;
  [menu addItem:doctor];

  NSMenuItem *cockpit = [[NSMenuItem alloc] initWithTitle:@"Open Cockpit" action:@selector(openCockpit:) keyEquivalent:@""];
  cockpit.target = self;
  [menu addItem:cockpit];

  NSMenuItem *logs = [[NSMenuItem alloc] initWithTitle:@"Open Sync Logs" action:@selector(openLogs:) keyEquivalent:@""];
  logs.target = self;
  [menu addItem:logs];

  NSMenuItem *restart = [[NSMenuItem alloc] initWithTitle:@"Restart Local Stack" action:@selector(restartLocalStack:) keyEquivalent:@""];
  restart.target = self;
  [menu addItem:restart];

  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:@"Quit Brain Monitor" action:@selector(terminate:) keyEquivalent:@"q"];
  quit.target = NSApp;
  [menu addItem:quit];

  self.statusItem.menu = menu;
}

- (void)openCockpit:(id)sender {
  (void)sender;
  [self startManagedProcess:@"cockpit" configKey:@"cockpitProcess"];
  NSString *urlString = [self stringConfig:@"cockpitUrl" fallback:@"http://127.0.0.1:8787/"];
  NSURL *url = [NSURL URLWithString:urlString];
  if (url) {
    [[NSWorkspace sharedWorkspace] openURL:url];
    self.lastAction = @"Opened cockpit";
  } else {
    self.lastAction = @"Invalid cockpit URL";
  }
  [self rebuildMenu:nil];
}

- (void)openLogs:(id)sender {
  (void)sender;
  NSString *logDir = [self stringConfig:@"logDir" fallback:@""];
  if (logDir.length > 0) {
    [[NSWorkspace sharedWorkspace] openURL:[NSURL fileURLWithPath:logDir isDirectory:YES]];
    self.lastAction = @"Opened logs";
  } else {
    self.lastAction = @"No log directory configured";
  }
  [self rebuildMenu:nil];
}

- (void)refreshDoctor:(id)sender {
  (void)sender;
  [self runDoctorTask];
  [self rebuildMenu:nil];
}

- (void)runDoctorTask {
  NSString *nodePath = [self stringConfig:@"nodePath" fallback:@""];
  NSString *doctorScriptPath = [self stringConfig:@"doctorScriptPath" fallback:@""];
  NSString *repoRoot = [self stringConfig:@"repoRoot" fallback:@""];
  NSString *outputPath = [self stringConfig:@"doctorOutputPath" fallback:@""];
  NSString *errorPath = [self stringConfig:@"doctorErrorPath" fallback:@""];
  if (nodePath.length == 0 || doctorScriptPath.length == 0 || outputPath.length == 0 || errorPath.length == 0) {
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
  task.arguments = @[doctorScriptPath];
  if (repoRoot.length > 0) {
    task.currentDirectoryPath = repoRoot;
  }
  NSMutableDictionary *environment = [[[NSProcessInfo processInfo] environment] mutableCopy];
  NSDictionary *configuredEnv = self.config[@"env"];
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
      weakSelf.lastAction = [NSString stringWithFormat:@"Doctor exited %d", finishedTask.terminationStatus];
      [weakSelf rebuildMenu:nil];
    });
  };

  @try {
    [task launch];
    self.lastAction = @"Doctor running";
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
await fs.mkdir(logDir, { recursive: true });
await fs.mkdir(path.dirname(stateFile), { recursive: true });
await fs.mkdir(path.dirname(healthFile), { recursive: true });
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
      brainId,
      brainDir,
      stateFile,
      healthFile,
      logDir,
      syncLaunchdLabel,
      cockpitLaunchdLabel,
      cockpitUrl,
      nodePath,
      doctorScriptPath,
      doctorOutputPath,
      doctorErrorPath,
      note:
        "Launch the app to show Brain status in the macOS menu bar. It supervises the local sync watcher and cockpit server, opens logs, restarts the local stack, and refreshes hosted doctor output.",
    },
    null,
    2
  )
);
