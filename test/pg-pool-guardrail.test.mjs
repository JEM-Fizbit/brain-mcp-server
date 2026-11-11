import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { retryableConnectionCode, connectionErrorMetadata } from "../dist/services/connection-error.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "..", "src");

async function collectTsFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

test("every pg Pool construction site attaches an error logger", async () => {
  const files = await collectTsFiles(srcDir);
  const offenders = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf-8");
    if (text.includes("new Pool(") && !text.includes("attachPoolErrorLogger")) {
      offenders.push(path.relative(srcDir, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `pg.Pool sites without an error listener (idle-client errors crash the process): ${offenders.join(", ")}`
  );
});

test("attachPoolErrorLogger absorbs idle-client errors instead of crashing", async () => {
  const { attachPoolErrorLogger } = await import(
    path.join(__dirname, "..", "dist", "services", "pg-pool.js")
  );
  // pg.Pool extends EventEmitter; an un-listened "error" event throws.
  const pool = new EventEmitter();
  attachPoolErrorLogger(pool, "test-pool");
  pool.emit("error", new Error("idle client terminated"));
  assert.ok(true, "error event was absorbed");
});

test("connection errors preserve nested transport codes but reject unknown or mixed causes", () => {
  const network = code => Object.assign(new Error(""), {code});
  assert.equal(retryableConnectionCode(new AggregateError([network("ETIMEDOUT"), network("ENETUNREACH")])), "ETIMEDOUT");
  assert.equal(retryableConnectionCode(new Error("wrapped", {cause:network("EADDRNOTAVAIL")})), "EADDRNOTAVAIL");
  for (const bad of [new Error("unknown"), network("28P01"), network("42501"), network("42P01")]) {
    assert.equal(retryableConnectionCode(new AggregateError([network("ETIMEDOUT"),bad])), null);
  }
  assert.equal(retryableConnectionCode(new AggregateError([])), null);
  assert.equal(retryableConnectionCode(Object.assign(new Error("connection terminated"),{code:"28P01"})), null);
  const cyclic = new Error("cycle");cyclic.cause=cyclic;
  assert.equal(retryableConnectionCode(cyclic),null);
  let deep=network("ENETDOWN");for(let i=0;i<12;i++)deep=new Error("wrapper",{cause:deep});
  assert.equal(retryableConnectionCode(deep),null);
  assert.equal(retryableConnectionCode(new AggregateError(Array.from({length:33},()=>network("ENETDOWN")))),null);
});

test("pool diagnostics never serialize the client, error message, credentials or cancel key", async t => {
  const { attachPoolErrorLogger } = await import("../dist/services/pg-pool.js");
  const calls=[];t.mock.method(console,"error",(...args)=>calls.push(args));
  const error=Object.assign(new Error("synthetic-sensitive-message"),{
    code:"EADDRNOTAVAIL",client:{password:"synthetic-password",secretKey:"synthetic-cancel-key"},
  });
  const pool=attachPoolErrorLogger(new EventEmitter(),"fixture");pool.emit("error",error);
  assert.deepEqual(calls,[["[pg-pool:fixture] idle client error",{name:"Error",code:"EADDRNOTAVAIL",networkRetryable:true}]]);
  assert.doesNotMatch(JSON.stringify(calls),/synthetic/);
  assert.deepEqual(connectionErrorMetadata(new AggregateError([Object.assign(new Error(""),{code:"ENETDOWN"})])),
    {name:"AggregateError",code:"ENETDOWN",networkRetryable:true});
});
