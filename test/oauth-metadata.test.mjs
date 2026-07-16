import assert from "node:assert/strict";
import test from "node:test";

import { buildOauthConfig } from "../dist/oauth/config.js";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "../dist/oauth/metadata.js";

test("OAuth discovery documentation URL comes from deployment config", () => {
  const keys = [
    "MCP_OAUTH_PUBLIC_BASE",
    "MCP_OAUTH_DOCUMENTATION_URL",
    "MCP_OAUTH_SIGNING_SECRET",
    "GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_SECRET",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    MCP_OAUTH_PUBLIC_BASE: "https://brain.example.com",
    MCP_OAUTH_DOCUMENTATION_URL: "https://docs.example.com/brain-mcp",
    MCP_OAUTH_SIGNING_SECRET: "test-signing-secret",
    GITHUB_OAUTH_CLIENT_ID: "test-client",
    GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
  });

  try {
    const config = buildOauthConfig();
    assert.equal(config.documentationUrl, "https://docs.example.com/brain-mcp");
    assert.equal(
      protectedResourceMetadata(config).resource_documentation,
      "https://docs.example.com/brain-mcp"
    );
    assert.equal(
      authorizationServerMetadata(config).service_documentation,
      "https://docs.example.com/brain-mcp"
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
