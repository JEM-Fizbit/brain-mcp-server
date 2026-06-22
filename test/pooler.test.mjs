import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPoolerUrl, isSessionPoolerRisk } from "../dist/services/pooler.js";

const TXN = "postgresql://u.ref:pw@aws-1-eu-west-2.pooler.supabase.com:6543/postgres";
const SESSION = "postgresql://u.ref:pw@aws-1-eu-west-2.pooler.supabase.com:5432/postgres";
const DIRECT = "postgresql://u:pw@db.abcdefghijkl.supabase.co:5432/postgres";

test("classifyPoolerUrl: transaction pooler (:6543)", () => {
  const c = classifyPoolerUrl(TXN);
  assert.equal(c.mode, "transaction");
  assert.equal(c.port, 6543);
  assert.equal(isSessionPoolerRisk(TXN), false);
});

test("classifyPoolerUrl: session pooler (:5432) is the risk", () => {
  const c = classifyPoolerUrl(SESSION);
  assert.equal(c.mode, "session");
  assert.equal(c.port, 5432);
  assert.equal(isSessionPoolerRisk(SESSION), true);
});

test("classifyPoolerUrl: direct connection", () => {
  assert.equal(classifyPoolerUrl(DIRECT).mode, "direct");
});

test("classifyPoolerUrl: unset / unparseable", () => {
  assert.equal(classifyPoolerUrl(undefined).mode, "unknown");
  assert.equal(classifyPoolerUrl("").mode, "unknown");
  assert.equal(isSessionPoolerRisk(undefined), false);
});

test("classifyPoolerUrl never exposes credentials in the label", () => {
  assert.ok(!classifyPoolerUrl(SESSION).label.includes("pw"));
});
