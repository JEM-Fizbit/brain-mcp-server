#import <Foundation/Foundation.h>
#import <Security/Security.h>

// Secrets travel over pipes, never command arguments or files. Each account is
// immutable: rotation creates another item and changes the metadata pointer.
int main(int argc, const char *argv[]) { @autoreleasepool {
  if (argc != 3) return 64;
  NSString *operation = @(argv[1]), *account = @(argv[2]);
  if (![account hasPrefix:@"brain-fly-"] || account.length > 180) return 64;
  NSMutableDictionary *query = [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService:@"com.jem.brain.fly",
    (__bridge id)kSecAttrAccount:account} mutableCopy];
  OSStatus status;
  if ([operation isEqualToString:@"add"]) {
    NSData *secret = [[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
    if (secret.length < 10 || secret.length > 65536) return 64;
    SecTrustedApplicationRef app = NULL; SecAccessRef access = NULL;
    status = SecTrustedApplicationCreateFromPath(NULL, &app);
    if (status != errSecSuccess) return 1;
    status = SecAccessCreate(CFSTR("Brain Fly automation"), (__bridge CFArrayRef)@[(__bridge id)app], &access);
    CFRelease(app); if (status != errSecSuccess) return 1;
    query[(__bridge id)kSecAttrAccess] = (__bridge id)access;
    query[(__bridge id)kSecValueData] = secret;
    status = SecItemAdd((__bridge CFDictionaryRef)query, NULL); CFRelease(access);
  } else if ([operation isEqualToString:@"get"]) {
    // Background diagnostics never cause Keychain permission prompts.
    SecKeychainSetUserInteractionAllowed(false);
    query[(__bridge id)kSecReturnData] = @YES;
    CFTypeRef result = NULL;
    status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecSuccess && result) {
      [[NSFileHandle fileHandleWithStandardOutput] writeData:(__bridge NSData *)result]; CFRelease(result);
    }
  } else if ([operation isEqualToString:@"delete"]) {
    SecKeychainSetUserInteractionAllowed(false);
    status = SecItemDelete((__bridge CFDictionaryRef)query);
  } else return 64;
  if (status != errSecSuccess) { fprintf(stderr,"Keychain operation failed (%d)\n",(int)status); return 1; }
  return 0;
}}
