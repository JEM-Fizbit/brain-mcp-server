import { test, expect } from "@playwright/test";
import http from "node:http";
import net from "node:net";
import { accessAdminPage } from "../dist/admin/page.js";

async function openPort() {
  const server = net.createServer();
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => port ? resolve(port) : reject(new Error("Could not allocate a local port")));
    });
  });
}

const fixture = {
  grants: [
    {
      provider: "github",
      providerUserId: "257652621",
      login: "cillian-example",
      name: "Cillian Example",
      role: "owner",
      status: "active",
      graphRoles: [],
      drift: "unavailable",
      updatedAt: "2026-08-28T14:54:21.000Z",
    },
    {
      provider: "entra",
      providerUserId: "22222222-2222-4222-8222-222222222222",
      name: "Cillian McGorman",
      email: "cillian@example.test",
      role: "owner",
      status: "active",
      graphRoles: ["owner"],
      drift: "none",
      updatedAt: "2026-08-28T14:32:10.000Z",
    },
    {
      provider: "entra",
      providerUserId: "33333333-3333-4333-8333-333333333333",
      name: "Jeronimo Duque",
      email: "jeronimo@example.test",
      role: "reader",
      status: "active",
      graphRoles: [],
      drift: "missing",
      updatedAt: "2026-08-28T15:02:10.000Z",
    },
  ],
  audit: [],
};

async function startAccessPage() {
  const port = await openPort();
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", request.url?.startsWith("/admin/api/") ? "application/json" : "text/html; charset=utf-8");
    if (request.url === "/admin/api/session") {
      response.end(JSON.stringify({ authenticated: true, csrfToken: "test-csrf", name: "John Milad", expiresAt: Math.floor(Date.now() / 1000) + 900 }));
      return;
    }
    if (request.url === "/admin/api/access") {
      response.end(JSON.stringify(fixture));
      return;
    }
    if (request.url === "/admin/access" || request.url === "/") {
      response.end(accessAdminPage());
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${port}/admin/access` };
}

async function stopServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

for (const colorScheme of ["light", "dark"]) {
  for (const viewport of [
    { label: "desktop", width: 1280, height: 900 },
    { label: "narrow", width: 390, height: 844 },
  ]) {
    test(`access guidance is usable in ${colorScheme} ${viewport.label}`, async ({ browser }) => {
      const { server, url } = await startAccessPage();
      const context = await browser.newContext({ colorScheme, viewport });
      const page = await context.newPage();
      try {
        await page.goto(url);
        await expect(page.getByRole("heading", { name: "ERS Brain · Access & Roles" })).toBeVisible();
        await expect(page.getByText("MCP access and manual editing are separate", { exact: true })).toBeVisible();
        await expect(page.getByText(/Manual editing in SharePoint, OneDrive or Obsidian/)).toBeVisible();
        await expect(page.getByText(/not granted or removed here/)).toBeVisible();
        await expect(page.locator(".role-guide-item")).toHaveCount(4);
        await expect(page.getByText("Cannot manage access.", { exact: false })).toBeVisible();

        const reconcileHelp = page.getByText("What does “Review & reconcile” mean?", { exact: true });
        await expect(reconcileHelp).toBeVisible();
        await reconcileHelp.click();
        await expect(page.getByText(/system never chooses a role automatically/i)).toBeVisible();

        const githubRow = page.locator("#grants tr", { hasText: "Cillian Example" });
        await expect(githubRow.locator(".user-primary")).toHaveText("Cillian Example");
        await expect(githubRow.locator(".user-meta")).toHaveText("@cillian-example · GitHub ID 257652621");
        await expect(githubRow).toContainText("GitHub fallback · not managed here");
        await expect(githubRow).toContainText("Not managed here");
        await expect(githubRow.locator("button")).toHaveCount(0);

        const matchedRow = page.locator("#grants tr", { hasText: "Cillian McGorman" });
        await expect(matchedRow).toContainText("Matched · Owner");
        await expect(matchedRow.getByRole("button", { name: "Change" })).toBeVisible();

        const driftRow = page.locator("#grants tr", { hasText: "Jeronimo Duque" });
        await expect(driftRow).toContainText("Missing in Entra · expected Reader");
        await driftRow.getByRole("button", { name: "Review & reconcile" }).click();
        await expect(page.getByRole("heading", { name: "Review and reconcile access" })).toBeVisible();
        await expect(page.getByText(/Nothing changes until you confirm/i)).toBeVisible();
        await expect(page.locator("#roleHelp")).toContainText("Cannot ask an AI client to change content");
        await expect(page.locator("#roleHelp")).toContainText("Separate SharePoint manual-edit permissions are unaffected");
        await page.locator("#role").selectOption("owner");
        await expect(page.locator("#roleHelp")).toContainText("manage user access");
        await expect(page.getByRole("button", { name: "Confirm intended access" })).toBeVisible();

        const layout = await page.evaluate(() => ({
          noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          darkScheme: getComputedStyle(document.documentElement).colorScheme.includes("dark"),
          dialogFits: (() => {
            const rect = document.querySelector("dialog")?.getBoundingClientRect();
            return Boolean(rect) && rect.left >= 0 && rect.right <= document.documentElement.clientWidth;
          })(),
        }));
        expect(layout.noPageOverflow).toBe(true);
        expect(layout.dialogFits).toBe(true);
        expect(layout.darkScheme).toBe(colorScheme === "dark");
      } finally {
        await context.close();
        await stopServer(server);
      }
    });
  }
}
