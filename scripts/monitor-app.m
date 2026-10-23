#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <CommonCrypto/CommonDigest.h>
#ifdef MONITOR_SPARKLE
#import <Sparkle/Sparkle.h>
#endif

static NSDictionary *releaseInfo(void) {
  NSData *data=[NSData dataWithContentsOfFile:[[NSBundle mainBundle] pathForResource:@"monitor-release" ofType:@"json"]];
  return data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : @{};
}

// Keychain access stays in the signed app. There is no credential-export CLI.
static NSMutableDictionary *credentialQuery(NSDictionary *metadata) {
  NSString *bound=[NSString stringWithFormat:@"%@\n%@",metadata[@"origin"],metadata[@"brain_id"]];
  NSData *bytes=[bound dataUsingEncoding:NSUTF8StringEncoding];unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(bytes.bytes,(CC_LONG)bytes.length,digest);NSMutableString *account=[NSMutableString string];
  for(int i=0;i<CC_SHA256_DIGEST_LENGTH;i++)[account appendFormat:@"%02x",digest[i]];
  NSString *service=[NSString stringWithFormat:@"%@.monitor-oauth",[NSBundle mainBundle].bundleIdentifier];
  return [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,(__bridge id)kSecAttrService:service,(__bridge id)kSecAttrAccount:account} mutableCopy];
}
static NSDictionary *readCredential(NSDictionary *metadata) {
  NSMutableDictionary *query=credentialQuery(metadata);query[(__bridge id)kSecReturnData]=@YES;
  LAContext *context=[LAContext new];context.interactionNotAllowed=YES;query[(__bridge id)kSecUseAuthenticationContext]=context;
  CFTypeRef result=NULL;if(SecItemCopyMatching((__bridge CFDictionaryRef)query,&result)!=errSecSuccess)return nil;
  NSData *bytes=CFBridgingRelease(result);return [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
}
static BOOL writeCredential(NSDictionary *metadata,NSDictionary *credential) {
  NSData *bytes=[NSJSONSerialization dataWithJSONObject:credential options:0 error:nil];if(!bytes || bytes.length>16384)return NO;
  NSMutableDictionary *query=credentialQuery(metadata);NSDictionary *values=@{(__bridge id)kSecValueData:bytes};
  OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)query,(__bridge CFDictionaryRef)values);
  if(status==errSecItemNotFound){query[(__bridge id)kSecValueData]=bytes;query[(__bridge id)kSecAttrAccessible]=(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;status=SecItemAdd((__bridge CFDictionaryRef)query,NULL);}
  return status==errSecSuccess;
}

@interface MonitorApp : NSObject <NSApplicationDelegate
#ifdef MONITOR_SPARKLE
,SPUUpdaterDelegate
#endif
>
@property(strong) NSStatusItem *status;
@property(strong) NSDictionary *releaseMetadata;
@property(strong) NSTimer *timer;
@property(strong) NSTask *reportTask;
@property(strong) NSString *receipt;
@property(strong) NSString *updateState;
@property(strong) NSDate *lastPolicyAt;
@property(strong) NSWindow *window;
@property(strong) NSTextField *windowStatus;
#ifdef MONITOR_SPARKLE
@property(strong) SPUStandardUpdaterController *updater;
#endif
@end
@implementation MonitorApp
- (void)applicationDidFinishLaunching:(NSNotification *)note {
  (void)note;self.releaseMetadata=releaseInfo();self.receipt=@"Installation unverified — sign in to report";self.updateState=@"unknown";
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  self.status=[[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
  self.status.button.title=@"Brain";
#ifdef MONITOR_SPARKLE
  // This build has no sync workers, database credentials or developer checkout.
  // Developer and MDM builds do not link or start Sparkle.
  self.updater=[[SPUStandardUpdaterController alloc] initWithStartingUpdater:NO updaterDelegate:self userDriverDelegate:nil];
#endif
  [self menu];[self runReporter:NO];
  if(!readCredential(self.releaseMetadata))[self showMonitor:nil];
  self.timer=[NSTimer scheduledTimerWithTimeInterval:900 target:self selector:@selector(heartbeat:) userInfo:nil repeats:YES];
}
- (void)heartbeat:(id)sender {(void)sender;[self runReporter:NO];}
- (void)signin:(id)sender {(void)sender;[self runReporter:YES];}
- (void)showMonitor:(id)sender {
  (void)sender;
  if(!self.window) {
    self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,520,280) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
    self.window.releasedWhenClosed=NO;
    self.window.title=[NSString stringWithFormat:@"%@ · Brain Monitor",self.releaseMetadata[@"brain_id"]];
    NSTextField *intro=[NSTextField wrappingLabelWithString:@"Sign in once to register this installation and open your Brain's operational pages. Developer and IT update exclusions remain in force."];
    intro.frame=NSMakeRect(24,192,472,56);[self.window.contentView addSubview:intro];
    self.windowStatus=[NSTextField wrappingLabelWithString:self.receipt];self.windowStatus.frame=NSMakeRect(24,134,472,48);[self.window.contentView addSubview:self.windowStatus];
    NSArray *titles=@[@"Sign in / Register",@"Open Cockpit / Doctor",@"Open Change Log"];
    NSArray *actions=@[@"signin:",@"openCockpit:",@"openChanges:"];
    for(NSUInteger i=0;i<titles.count;i++) {
      NSButton *button=[NSButton buttonWithTitle:titles[i] target:self action:NSSelectorFromString(actions[i])];
      button.frame=NSMakeRect(20+i*164,82,160,32);[self.window.contentView addSubview:button];
    }
#ifdef MONITOR_SPARKLE
    NSButton *updates=[NSButton buttonWithTitle:@"Check for Updates…" target:self.updater action:@selector(checkForUpdates:)];
    updates.frame=NSMakeRect(20,34,190,32);[self.window.contentView addSubview:updates];
#endif
  }
  [self.window center];[self.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
}
- (void)openCockpit:(id)sender {(void)sender;[[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:[self.releaseMetadata[@"origin"] stringByAppendingString:@"/monitor"]]];}
- (void)openChanges:(id)sender {(void)sender;[[NSWorkspace sharedWorkspace] openURL:[NSURL URLWithString:[self.releaseMetadata[@"origin"] stringByAppendingString:@"/monitor/changes"]]];}
- (void)runReporter:(BOOL)login {
  if(self.reportTask.running)return;
  NSString *resources=[NSBundle mainBundle].resourcePath;
  NSTask *task=[NSTask new];self.reportTask=task;
  task.executableURL=[NSURL fileURLWithPath:[resources stringByAppendingPathComponent:@"runtime/node"]];
  task.arguments=@[[resources stringByAppendingPathComponent:@"scripts/monitor-client.mjs"],login?@"login":@"report",self.updateState];
  // No ambient Brain, Node flags, preload hooks, or developer environment.
  task.environment=@{@"HOME":NSHomeDirectory(),@"PATH":@"/usr/bin:/bin:/usr/sbin:/sbin"};
  NSPipe *pipe=[NSPipe pipe],*input=[NSPipe pipe];task.standardInput=input;task.standardOutput=pipe;task.standardError=[NSFileHandle fileHandleWithNullDevice];
  __weak typeof(self) weakSelf=self;
  task.terminationHandler=^(NSTask *completed){
    (void)completed;
    NSData *data=[pipe.fileHandleForReading readDataToEndOfFile];
    NSDictionary *receipt=data.length ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    dispatch_async(dispatch_get_main_queue(),^{
      BOOL saved=YES;
      if([receipt[@"credentials"] isKindOfClass:[NSDictionary class]])saved=writeCredential(weakSelf.releaseMetadata,receipt[@"credentials"]);
      weakSelf.receipt=!saved?@"Keychain unavailable — sign in again":[receipt[@"ok"] boolValue]?@"Installation report accepted":@"Report unavailable — sign in or check access";
#ifdef MONITOR_SPARKLE
      BOOL admitted=saved && [receipt[@"ok"] boolValue] && [receipt[@"update_mode"] isEqualToString:@"automatic"];
      weakSelf.lastPolicyAt=admitted?[NSDate date]:nil;
      if(admitted)[weakSelf.updater startUpdater];
#endif
      [weakSelf menu];
    });
  };
  NSError *error=nil;
  if(![task launchAndReturnError:&error]){self.receipt=@"Reporter unavailable";[self menu];return;}
  NSData *ipc=[NSJSONSerialization dataWithJSONObject:@{@"credentials":readCredential(self.releaseMetadata) ?: (id)[NSNull null]} options:0 error:nil];
  [input.fileHandleForWriting writeData:ipc];[input.fileHandleForWriting closeFile];
}
- (void)menu {
  self.windowStatus.stringValue=[NSString stringWithFormat:@"Monitor %@ (%@) · %@\n%@ · %@",self.releaseMetadata[@"app_version"],self.releaseMetadata[@"build"],self.receipt,self.releaseMetadata[@"update_mode"],self.updateState];
  NSMenu *menu=[NSMenu new];
  NSArray *labels=@[[NSString stringWithFormat:@"Monitor %@ (%@)",self.releaseMetadata[@"app_version"],self.releaseMetadata[@"build"]],
    [NSString stringWithFormat:@"Brain: %@",self.releaseMetadata[@"brain_id"]],self.receipt,
    [NSString stringWithFormat:@"Updates: %@ · %@",self.releaseMetadata[@"update_mode"],self.updateState]];
  for(NSString *label in labels){NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:label action:NULL keyEquivalent:@""];[menu addItem:item];}
  [menu addItem:[NSMenuItem separatorItem]];
  for(NSArray *entry in @[@[@"Show Monitor",@"showMonitor:"],@[@"Open Cockpit / Doctor",@"openCockpit:"],@[@"Open Change Log",@"openChanges:"],@[@"Sign in / Register this Monitor",@"signin:"]]) {
    NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:entry[0] action:NSSelectorFromString(entry[1]) keyEquivalent:@""];item.target=self;[menu addItem:item];
  }
#ifdef MONITOR_SPARKLE
  NSMenuItem *updates=[[NSMenuItem alloc] initWithTitle:@"Check for Updates…" action:@selector(checkForUpdates:) keyEquivalent:@""];
  updates.target=self.updater;[menu addItem:updates];
#endif
  [menu addItem:[NSMenuItem separatorItem]];
  NSMenuItem *quit=[[NSMenuItem alloc] initWithTitle:@"Quit Brain Monitor" action:@selector(terminate:) keyEquivalent:@"q"];quit.target=NSApp;[menu addItem:quit];
  self.status.menu=menu;
}
- (void)applicationWillTerminate:(NSNotification *)note {(void)note;[self.timer invalidate];if(self.reportTask.running)[self.reportTask terminate];}
#ifdef MONITOR_SPARKLE
- (BOOL)updater:(SPUUpdater *)updater mayPerformUpdateCheck:(SPUUpdateCheck)check error:(NSError * __autoreleasing *)error {
  (void)updater;(void)check;
  if(!self.lastPolicyAt || -[self.lastPolicyAt timeIntervalSinceNow]>1200) {
    self.updateState=@"deferred";[self menu];
    if(error)*error=[NSError errorWithDomain:@"BrainMonitor" code:1 userInfo:@{NSLocalizedDescriptionKey:@"Register this Monitor with an eligible automatic-update identity first. Developer and IT exclusions remain in force."}];
    return NO;
  }
  self.updateState=@"checking";[self menu];return YES;
}
- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item {(void)updater;(void)item;self.updateState=@"available";[self menu];}
- (void)updater:(SPUUpdater *)updater didDownloadUpdate:(SUAppcastItem *)item {(void)updater;(void)item;self.updateState=@"downloaded";[self menu];}
- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error {(void)updater;(void)error;self.updateState=@"failed";[self menu];}
- (void)updaterDidNotFindUpdate:(SPUUpdater *)updater error:(NSError *)error {
  (void)updater;self.updateState=[error.userInfo[SPUNoUpdateFoundReasonKey] integerValue]==SPUNoUpdateFoundReasonOnLatestVersion?@"current":@"deferred";[self menu];
}
#endif
@end
int main(int argc,const char *argv[]) {
  @autoreleasepool {
    (void)argv;if(argc>1)return 64;
    NSApplication *app=[NSApplication sharedApplication];MonitorApp *delegate=[MonitorApp new];app.delegate=delegate;[app run];
  }return 0;
}
