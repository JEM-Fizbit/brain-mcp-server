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
const healthFile = process.env.BRAIN_SYNC_HEALTH_FILE || `${stateFile}.health.json`;
const logDir = process.env.BRAIN_SYNC_LAUNCHD_LOG_DIR || syncDir;
const syncLaunchdLabel =
  process.env.BRAIN_SYNC_HELPER_LAUNCHD_LABEL ||
  process.env.BRAIN_SYNC_LAUNCHD_LABEL ||
  "com.jem.brain-sync.helper";
const cockpitLaunchdLabel =
  process.env.BRAIN_COCKPIT_LAUNCHD_LABEL || "com.jem.brain-cockpit";
const cockpitHost = process.env.BRAIN_COCKPIT_HOST || "127.0.0.1";
const cockpitPort = Number(process.env.BRAIN_COCKPIT_PORT || 8787);
const cockpitUrl =
  process.env.BRAIN_COCKPIT_URL || `http://${cockpitHost}:${cockpitPort}/`;
const nodePath =
  process.env.BRAIN_MENUBAR_NODE ||
  process.env.BRAIN_COCKPIT_LAUNCHD_NODE ||
  process.execPath;
const doctorScriptPath =
  process.env.BRAIN_MENUBAR_DOCTOR_SCRIPT ||
  path.join(repoRoot, "scripts", "hosted-doctor.mjs");
const doctorOutputPath =
  process.env.BRAIN_MENUBAR_DOCTOR_OUTPUT ||
  path.join(logDir, "hosted-doctor.out.json");
const doctorErrorPath =
  process.env.BRAIN_MENUBAR_DOCTOR_ERROR ||
  path.join(logDir, "hosted-doctor.err.log");
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
  ["BRAIN_SYNC_HEALTH_FILE", healthFile],
  ["BRAIN_SYNC_LAUNCHD_LOG_DIR", logDir],
  ["BRAIN_MENUBAR_NODE", nodePath],
  ["BRAIN_MENUBAR_DOCTOR_SCRIPT", doctorScriptPath],
  ["BRAIN_MENUBAR_DOCTOR_OUTPUT", doctorOutputPath],
  ["BRAIN_MENUBAR_DOCTOR_ERROR", doctorErrorPath],
]) {
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be absolute: ${value}`);
  }
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
  doctorOutputPath,
  doctorErrorPath,
  env: {
    BRAIN_ID: brainId,
    BRAIN_DIR: brainDir,
    BRAIN_SYNC_STATE_FILE: stateFile,
    BRAIN_SYNC_HEALTH_FILE: healthFile,
    BRAIN_SYNC_LAUNCHD_LABEL: syncLaunchdLabel,
    PATH: runtimePath,
  },
};

const nativeSource = `#import <Cocoa/Cocoa.h>
#include <unistd.h>

@interface BrainMenuAppDelegate : NSObject <NSApplicationDelegate>
@property (strong) NSStatusItem *statusItem;
@property (strong) NSDictionary *config;
@property (copy) NSString *lastAction;
@end

@implementation BrainMenuAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  self.config = [self loadConfig];
  self.lastAction = @"Ready";
  self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
  self.statusItem.button.title = @"Brain";
  [self rebuildMenu:nil];
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

  self.statusItem.button.title = [self statusTitleForHealth:health];

  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Brain Monitor"];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Brain: %@", brainId]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Status: %@", status]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Last check: %@", checkedAt]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Last sync: %@", lastSyncAt]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Cycle: %@ (%@)", cycle, duration]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Changes: +%@ / -%@ / same %@", pushed, pulled, unchanged]];
  [self addDisabledItem:menu title:[NSString stringWithFormat:@"Open conflicts: %@", conflicts]];
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

  NSMenuItem *restart = [[NSMenuItem alloc] initWithTitle:@"Restart Sync Helper" action:@selector(restartSyncHelper:) keyEquivalent:@""];
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
  NSString *label = [self stringConfig:@"cockpitLaunchdLabel" fallback:@""];
  [self bootstrapLaunchdLabelIfNeeded:label];
  [self kickstartLaunchdLabel:label kill:NO];
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

- (void)restartSyncHelper:(id)sender {
  (void)sender;
  NSString *label = [self stringConfig:@"syncLaunchdLabel" fallback:@""];
  [self bootstrapLaunchdLabelIfNeeded:label];
  [self kickstartLaunchdLabel:label kill:YES];
  self.lastAction = label.length > 0 ? @"Restarted sync helper" : @"No sync label configured";
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

- (void)bootstrapLaunchdLabelIfNeeded:(NSString *)label {
  if (label.length == 0) {
    return;
  }
  NSString *domain = [NSString stringWithFormat:@"gui/%d", getuid()];
  NSString *domainLabel = [NSString stringWithFormat:@"%@/%@", domain, label];
  int printed = [self runTask:@"/bin/launchctl" arguments:@[@"print", domainLabel] wait:YES];
  if (printed == 0) {
    return;
  }
  NSString *plistPath = [NSHomeDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"Library/LaunchAgents/%@.plist", label]];
  if ([[NSFileManager defaultManager] fileExistsAtPath:plistPath]) {
    [self runTask:@"/bin/launchctl" arguments:@[@"bootstrap", domain, plistPath] wait:YES];
  }
}

- (void)kickstartLaunchdLabel:(NSString *)label kill:(BOOL)kill {
  if (label.length == 0) {
    return;
  }
  NSString *domainLabel = [NSString stringWithFormat:@"gui/%d/%@", getuid(), label];
  NSArray *arguments = kill ? @[@"kickstart", @"-k", domainLabel] : @[@"kickstart", domainLabel];
  [self runTask:@"/bin/launchctl" arguments:arguments wait:NO];
}

- (int)runTask:(NSString *)launchPath arguments:(NSArray *)arguments wait:(BOOL)wait {
  NSTask *task = [[NSTask alloc] init];
  task.launchPath = launchPath;
  task.arguments = arguments;
  task.standardOutput = [NSPipe pipe];
  task.standardError = [NSPipe pipe];
  @try {
    [task launch];
    if (wait) {
      [task waitUntilExit];
      return task.terminationStatus;
    }
    return 0;
  } @catch (NSException *exception) {
    (void)exception;
    return 127;
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
        "Launch the app to show Brain status in the macOS menu bar. It opens/kicks cockpit, restarts the sync helper, opens logs, and refreshes hosted doctor output.",
    },
    null,
    2
  )
);
