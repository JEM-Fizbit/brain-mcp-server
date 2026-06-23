import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { postSlackMessage } = await import(
  path.join(__dirname, "..", "dist", "services", "slack.js")
);

test("postSlackMessage is a no-op (no network) when no token is provided", async () => {
  let fetched = false;
  const result = await postSlackMessage("C-OPS", "hello", {
    token: undefined,
    fetchImpl: async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "disabled");
  assert.equal(fetched, false);
});

test("postSlackMessage posts to chat.postMessage and reports Slack ok", async () => {
  let seen = null;
  const result = await postSlackMessage("C-OPS", "hello", {
    token: "xoxb-test",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seen.url, "https://slack.com/api/chat.postMessage");
  assert.equal(seen.init.headers.Authorization, "Bearer xoxb-test");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.channel, "C-OPS");
  assert.equal(body.text, "hello");
});

test("postSlackMessage surfaces a Slack API error without throwing", async () => {
  const result = await postSlackMessage("C-OPS", "hello", {
    token: "xoxb-test",
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), {
        status: 200,
      }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "channel_not_found");
});
