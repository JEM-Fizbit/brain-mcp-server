import { constantTimeEqual, sha256Base64url } from "./crypto.js";

export function isValidVerifierFormat(verifier: string): boolean {
  return (
    verifier.length >= 43 &&
    verifier.length <= 128 &&
    /^[A-Za-z0-9\-._~]+$/.test(verifier)
  );
}

export function verifyChallenge(args: {
  verifier: string;
  challenge: string;
  method: string;
}): boolean {
  if (args.method !== "S256") return false;
  if (!isValidVerifierFormat(args.verifier)) return false;
  if (!/^[A-Za-z0-9\-_]{43}$/.test(args.challenge)) return false;
  return constantTimeEqual(sha256Base64url(args.verifier), args.challenge);
}
