import test from "node:test";
import assert from "node:assert/strict";

import { hostedHealthFailureDetails } from "../scripts/lib/hosted-health-failure.mjs";

const baseUrl = "https://brain.example.com";

test("hosted health timeout is a local-connectivity warning candidate", () => {
  const timeout = Object.assign(
    new Error("The operation was aborted due to timeout"),
    { name: "TimeoutError", code: 23 }
  );

  assert.deepEqual(hostedHealthFailureDetails(timeout, baseUrl), {
    baseUrl,
    error: "The operation was aborted due to timeout",
    code: 23,
    connectivity: "unreachable",
    faultDomain: "local_connectivity",
    diagnosis:
      "The local device could not reach the hosted Brain endpoint. Check Wi-Fi, VPN, DNS, or local network access before treating this as a Brain MCP stack fault.",
  });
});

test("hosted health route errors remain local-connectivity warning candidates", () => {
  const routeError = Object.assign(new Error("fetch failed"), {
    cause: Object.assign(new Error("connect EHOSTUNREACH 66.241.124.103:443"), {
      code: "EHOSTUNREACH",
    }),
  });

  const details = hostedHealthFailureDetails(routeError, baseUrl);

  assert.equal(details.faultDomain, "local_connectivity");
  assert.equal(details.code, "EHOSTUNREACH");
  assert.match(details.cause, /EHOSTUNREACH/);
});

test("non-transport hosted health errors remain hosted-stack failures", () => {
  const details = hostedHealthFailureDetails(
    new Error("hosted health response could not be decoded"),
    baseUrl
  );

  assert.equal(details.faultDomain, "hosted_stack");
  assert.equal(details.connectivity, "unreachable");
});
