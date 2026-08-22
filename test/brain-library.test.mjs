import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  ArtifactResolver,
  createBrainLibraryServer,
  loadLibrarySnapshot,
  readLibraryFile,
  renderMarkdown,
} = await import(path.join(__dirname, "..", "dist", "brain-library", "index.js"));
const { compileSourceReference } = await import(
  path.join(__dirname, "..", "dist", "source-references", "index.js")
);
const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_ID = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "brain-library-"));
  const localRoot = path.join(root, "dropbox");
  await fs.mkdir(path.join(root, "brain"), { recursive: true });
  await fs.mkdir(path.join(root, "sources", "research"), { recursive: true });
  await fs.mkdir(localRoot, { recursive: true });
  await fs.writeFile(
    path.join(root, "brain", "00_loader.md"),
    "# Brain map\n\nOpen [[08_personal|Personal context]].\n\n<script>alert('no')</script>\n",
    "utf-8"
  );
  await fs.writeFile(
    path.join(root, "brain", "08_personal.md"),
    "# Personal context\n\n[Evidence](../sources/research/radiology.md)\n",
    "utf-8"
  );
  await fs.writeFile(path.join(localRoot, "artifact.txt"), "artifact", "utf-8");
  const compiled = compileSourceReference({
    schema: "brain.source-reference/v1",
    brainId: "ai-brain-jem",
    sourceId: SOURCE_ID,
    label: "Radiology context",
    category: "research",
    status: "processed",
    evidenceTier: "analysis",
    provenanceNote: "Reviewed local analysis with Dropbox identity.",
    companionPath: "sources/research/radiology.md",
    sourceUrls: [{ label: "Dropbox", url: "https://www.dropbox.com/s/example" }],
    artifacts: [
      {
        id: ARTIFACT_ID,
        kind: "original",
        label: "Original context",
        provider: "Dropbox",
        providerId: "id:test",
        providerRevision: "rev-test",
        webUrl: "https://www.dropbox.com/s/example",
        rootAlias: "dropbox_personal",
        relativePath: "artifact.txt",
      },
    ],
    brainLinks: [
      { filename: "08_personal.md", relation: "context", label: "Personal context" },
    ],
    summary: "A non-sensitive source fixture.",
    contentMarkdown: "## Reviewed finding\n\nThe artifact is traceable.",
  });
  await fs.writeFile(
    path.join(root, "sources", "research", "radiology.md"),
    compiled.markdown,
    "utf-8"
  );
  return { root, localRoot };
}

function request(port, method, requestPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: requestPath, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf-8"),
          })
        );
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("Brain Library indexes only safe Brain/source Markdown and renders portable navigation", async () => {
  const { root } = await fixture();
  const snapshot = await loadLibrarySnapshot(root);
  assert.deepEqual(
    snapshot.files.map((file) => file.repoPath),
    ["brain/00_loader.md", "brain/08_personal.md", "sources/research/radiology.md"]
  );
  assert.equal(snapshot.artifacts.get(ARTIFACT_ID).sourceId, SOURCE_ID);
  const source = await readLibraryFile(snapshot, "sources/research/radiology.md");
  assert.equal(source.manifest.providerRevision, undefined);
  assert.equal(source.manifest.artifacts[0].providerRevision, "rev-test");
  await assert.rejects(() => readLibraryFile(snapshot, "../secret.md"), /Unsafe/);
  const html = renderMarkdown(snapshot.files[0].markdown, "brain/00_loader.md");
  assert.match(html, /\/view\?file=brain%2F08_personal\.md/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  const sourceHtml = renderMarkdown(source.markdown, source.repoPath);
  assert.doesNotMatch(sourceHtml, /brain\.source-reference\/v1/);
});

test("Artifact resolver requires registered ids and contains symlinks inside the allowlisted root", async () => {
  const { root, localRoot } = await fixture();
  const snapshot = await loadLibrarySnapshot(root);
  const resolver = new ArtifactResolver(
    { dropbox_personal: localRoot },
    snapshot.artifacts
  );
  const resolved = await resolver.resolve(ARTIFACT_ID);
  assert.equal(resolved.relativePath, "artifact.txt");
  assert.equal(resolved.absolutePath, await fs.realpath(path.join(localRoot, "artifact.txt")));
  await assert.rejects(() => resolver.resolve("missing"), /Unknown artifact id/);

  const outside = path.join(root, "outside.txt");
  await fs.writeFile(outside, "outside", "utf-8");
  await fs.symlink(outside, path.join(localRoot, "escape.txt"));
  const escaped = new Map(snapshot.artifacts);
  escaped.set("escape", {
    sourceId: SOURCE_ID,
    artifact: {
      ...snapshot.artifacts.get(ARTIFACT_ID).artifact,
      id: "escape",
      relativePath: "escape.txt",
    },
  });
  const escapedResolver = new ArtifactResolver({ dropbox_personal: localRoot }, escaped);
  await assert.rejects(() => escapedResolver.resolve("escape"), /symlink escapes/);
});

test("Brain Library HTTP surface is loopback-only, read-only, CSP-protected, and local-open disabled by default", async () => {
  const { root, localRoot } = await fixture();
  const server = createBrainLibraryServer({
    brainRoot: root,
    brainId: "ai-brain-jem",
    roots: { dropbox_personal: localRoot },
  });
  const port = await listen(server);
  try {
    const page = await request(
      port,
      "GET",
      `/view?file=${encodeURIComponent("sources/research/radiology.md")}`
    );
    assert.equal(page.status, 200);
    assert.match(page.headers["content-security-policy"], /default-src 'none'/);
    assert.match(page.text, /Brain Library/);
    assert.match(page.text, /Source details/);
    assert.match(page.text, /LLM trace/);
    assert.match(page.text, /target="_blank" rel="noopener noreferrer"/);
    assert.match(page.text, new RegExp(`data-artifact-id="${ARTIFACT_ID}" disabled`));
    const nonce = page.text.match(/x-brain-library-nonce':'([^']+)'/)?.[1];
    assert.ok(nonce);

    const disabled = await request(port, "POST", "/api/open-artifact", {
      headers: {
        "content-type": "application/json",
        "x-brain-library-nonce": nonce,
      },
      body: JSON.stringify({ artifactId: ARTIFACT_ID }),
    });
    assert.equal(disabled.status, 403);

    const badHost = await request(port, "GET", "/health", {
      headers: { host: "evil.example.com" },
    });
    assert.equal(badHost.status, 403);
    const mutation = await request(port, "PUT", "/view", { body: "no" });
    assert.equal(mutation.status, 404);
  } finally {
    await close(server);
  }
});

test("Brain Library local opening requires both the runtime flag and page nonce", async () => {
  const { root, localRoot } = await fixture();
  const opened = [];
  const server = createBrainLibraryServer({
    brainRoot: root,
    brainId: "ai-brain-jem",
    roots: { dropbox_personal: localRoot },
    allowLocalOpen: true,
    openArtifact: async (absolutePath) => opened.push(absolutePath),
  });
  const port = await listen(server);
  try {
    const missingNonce = await request(port, "POST", "/api/open-artifact", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifactId: ARTIFACT_ID }),
    });
    assert.equal(missingNonce.status, 403);

    const page = await request(port, "GET", "/");
    const nonce = page.text.match(/x-brain-library-nonce':'([^']+)'/)?.[1];
    assert.ok(nonce);
    const wrongType = await request(port, "POST", "/api/open-artifact", {
      headers: { "content-type": "text/plain", "x-brain-library-nonce": nonce },
      body: JSON.stringify({ artifactId: ARTIFACT_ID }),
    });
    assert.equal(wrongType.status, 415);

    const openedResponse = await request(port, "POST", "/api/open-artifact", {
      headers: { "content-type": "application/json", "x-brain-library-nonce": nonce },
      body: JSON.stringify({ artifactId: ARTIFACT_ID }),
    });
    assert.equal(openedResponse.status, 200);
    assert.deepEqual(opened, [await fs.realpath(path.join(localRoot, "artifact.txt"))]);
    assert.match(openedResponse.text, /dropbox_personal:artifact\.txt/);
  } finally {
    await close(server);
  }
});
