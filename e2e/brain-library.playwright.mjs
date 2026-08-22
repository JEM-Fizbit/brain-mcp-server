import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compileSourceReference } from "../dist/source-references/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

async function openPort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error("No local port"))));
    });
  });
}

async function seed(testInfo) {
  const root = testInfo.outputPath("jem-brain");
  await fs.mkdir(path.join(root, "brain"), { recursive: true });
  await fs.mkdir(path.join(root, "sources", "research"), { recursive: true });
  await fs.writeFile(
    path.join(root, "brain", "00_loader.md"),
    "# JEM Brain map\n\nA calm, navigable map of durable context. Open [[08_personal|Personal context]].\n",
    "utf-8"
  );
  await fs.writeFile(
    path.join(root, "brain", "08_personal.md"),
    "# Personal context\n\n## Current evidence\n\n[Radiology AI research context](../sources/research/2026-04-10_radiology-ai-context.md) supports this note.\n",
    "utf-8"
  );
  const source = compileSourceReference({
    schema: "brain.source-reference/v1",
    brainId: "ai-brain-jem",
    sourceId: "11111111-1111-4111-8111-111111111111",
    label: "Radiology AI research context",
    category: "research",
    status: "processed",
    evidenceTier: "analysis",
    sourceDate: "2026-04-10",
    provenanceNote: "Reviewed context document mirrored in Dropbox; exact provider identity retained.",
    evidenceLimitation: "This pilot validates traceability and navigation, not the underlying research conclusions.",
    companionPath: "sources/research/2026-04-10_radiology-ai-context.md",
    sourceUrls: [
      { label: "Open Dropbox source", url: "https://www.dropbox.com/scl/fi/example-fixture" },
    ],
    artifacts: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        kind: "original",
        label: "Research context Markdown",
        provider: "Dropbox",
        providerId: "id:fixture-radiology-context",
        providerRevision: "fixture-revision-1",
        webUrl: "https://www.dropbox.com/scl/fi/example-fixture",
        rootAlias: "dropbox_personal",
        relativePath: "Research/Radiology/2026-04-10_context.md",
        contentSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mimeType: "text/markdown",
        byteSize: 20107,
        observedAt: "2026-04-09T23:32:30.000Z",
      },
    ],
    brainLinks: [
      { filename: "08_personal.md", relation: "context", label: "Personal context" },
    ],
    summary: "A non-sensitive pilot record proving source-to-Brain and Brain-to-source navigation.",
    contentMarkdown: "## Reviewed finding\n\nThe portable link, stable Dropbox identity, exact revision and hash are visible to both humans and tools.",
  });
  await fs.writeFile(
    path.join(root, "sources", "research", "2026-04-10_radiology-ai-context.md"),
    source.markdown,
    "utf-8"
  );
  return root;
}

async function start(testInfo) {
  const root = await seed(testInfo);
  const port = await openPort();
  const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "brain-library.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BRAIN_LIBRARY_ROOT: root,
      BRAIN_LIBRARY_BRAIN_ID: "ai-brain-jem",
      BRAIN_LIBRARY_PORT: String(port),
      BRAIN_LIBRARY_ALLOW_LOCAL_OPEN: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Library startup timeout\n${output}`)), 10000);
    const inspect = (chunk) => {
      output += String(chunk);
      const match = output.match(/JEM Brain Library: (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Library exited with ${code}\n${output}`));
    });
  });
  return { child, url };
}

async function stop(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

test("JEM Brain Library provides traceable desktop navigation in light and dark modes", async ({ page }, testInfo) => {
  const { child, url } = await start(testInfo);
  try {
    await page.goto(url);
    await expect(page.getByText("Brain Library", { exact: true })).toBeVisible();
    await expect(page.locator(".paper h1")).toHaveText("JEM Brain map");
    await page.locator(".paper").getByRole("link", { name: "Personal context" }).click();
    await expect(page.locator(".paper h1")).toHaveText("Personal context");
    await page.locator(".paper").getByRole("link", { name: "Radiology AI research context" }).click();
    await expect(page.locator(".paper h1")).toHaveText("Radiology AI research context");
    await expect(page.locator(".source-panel")).toContainText("id:fixture-radiology-context");
    await expect(page.locator(".source-panel")).toContainText("fixture-revision-1");
    await expect(page.getByRole("button", { name: "Open local mirror" })).toBeDisabled();
    const webLink = page.locator(".source-panel").getByRole("link", { name: "Open in Dropbox" });
    await expect(webLink).toHaveAttribute("target", "_blank");
    await expect(webLink).toHaveAttribute("rel", "noopener noreferrer");
    await page.getByText("LLM trace").click();
    await expect(page.locator(".source-panel pre")).toContainText("brain.source-reference/v1");
    await expect(page.locator(".paper")).not.toContainText("brain.source-reference/v1");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("brain-library-desktop-light.png"), fullPage: true });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBackground).toBe("rgb(23, 26, 23)");
    await page.screenshot({ path: testInfo.outputPath("brain-library-desktop-dark.png"), fullPage: true });
  } finally {
    await stop(child);
  }
});

test("JEM Brain Library remains usable at 390px without horizontal overflow", async ({ page }, testInfo) => {
  const { child, url } = await start(testInfo);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${url}view?file=${encodeURIComponent("sources/research/2026-04-10_radiology-ai-context.md")}`);
    await expect(page.locator(".paper h1")).toHaveText("Radiology AI research context");
    await expect(page.locator(".source-panel")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath("brain-library-mobile.png"), fullPage: true });
  } finally {
    await stop(child);
  }
});
