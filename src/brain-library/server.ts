import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { ArtifactResolver } from "./resolver.js";
import {
  loadLibrarySnapshot,
  readLibraryFile,
  renderMarkdown,
  type LibraryFile,
  type LibrarySnapshot,
} from "./library.js";

export interface BrainLibraryServerOptions {
  brainRoot: string;
  brainId: string;
  roots: Readonly<Record<string, string>>;
  allowLocalOpen?: boolean;
  openArtifact?: (absolutePath: string) => Promise<void>;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isLoopbackHost(request: IncomingMessage): boolean {
  const host = String(request.headers.host || "");
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

async function readJson(request: IncomingMessage, maxBytes = 16 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {};
}

function securityHeaders(response: ServerResponse, cspNonce: string): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader(
    "content-security-policy",
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${cspNonce}'; img-src data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  );
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload)}\n`);
}

function navSection(title: string, files: LibraryFile[], current: string): string {
  const links = files
    .map(
      (file) =>
        `<li><a href="/view?file=${encodeURIComponent(file.repoPath)}"${
          file.repoPath === current ? ' aria-current="page"' : ""
        }>${escapeHtml(file.title)}</a></li>`
    )
    .join("");
  return `<section class="nav-section"><h2>${escapeHtml(title)}</h2><ul>${links}</ul></section>`;
}

function sourcePanel(file: LibraryFile, allowLocalOpen: boolean): string {
  const manifest = file.manifest;
  if (!manifest) {
    if (file.kind !== "source") return "";
    return `<aside class="source-panel"><span class="eyebrow">Source details</span><p class="muted">Legacy companion: no embedded source-reference manifest yet.</p></aside>`;
  }
  const links = manifest.sourceUrls
    .map(
      (item) =>
        `<a class="action secondary" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a>`
    )
    .join("");
  const artifacts = manifest.artifacts
    .map((artifact) => {
      const web = artifact.webUrl
        ? `<a class="action secondary" href="${escapeHtml(artifact.webUrl)}" target="_blank" rel="noopener noreferrer">Open in ${escapeHtml(artifact.provider || "browser")}</a>`
        : "";
      const local = artifact.rootAlias && artifact.relativePath
        ? `<button class="action local-open" data-artifact-id="${escapeHtml(artifact.id)}"${
            allowLocalOpen ? "" : " disabled"
          }>Open local mirror</button>`
        : "";
      return `<article class="artifact"><strong>${escapeHtml(artifact.label)}</strong><dl><dt>ID</dt><dd><code>${escapeHtml(artifact.id)}</code></dd>${
        artifact.providerId ? `<dt>Provider ID</dt><dd><code>${escapeHtml(artifact.providerId)}</code></dd>` : ""
      }${
        artifact.providerRevision ? `<dt>Revision</dt><dd><code>${escapeHtml(artifact.providerRevision)}</code></dd>` : ""
      }${
        artifact.contentSha256 ? `<dt>SHA-256</dt><dd><code>${escapeHtml(artifact.contentSha256)}</code></dd>` : ""
      }${
        artifact.rootAlias ? `<dt>Local locator</dt><dd><code>${escapeHtml(artifact.rootAlias)}:${escapeHtml(artifact.relativePath)}</code></dd>` : ""
      }</dl><div class="actions">${web}${local}</div></article>`;
    })
    .join("");
  return `<aside class="source-panel"><span class="eyebrow">Source details</span><h2>${escapeHtml(manifest.label)}</h2><p>${escapeHtml(manifest.provenanceNote)}</p><div class="chips"><span>${escapeHtml(manifest.evidenceTier.replace(/_/g, " "))}</span><span>${escapeHtml(manifest.status)}</span></div><div class="actions">${links}</div>${artifacts}<details><summary>LLM trace</summary><pre>${escapeHtml(JSON.stringify({
    schema: manifest.schema,
    brainId: manifest.brainId,
    sourceId: manifest.sourceId,
    companionPath: manifest.companionPath,
    sourceUrls: manifest.sourceUrls,
    artifacts: manifest.artifacts,
    brainLinks: manifest.brainLinks,
  }, null, 2))}</pre></details></aside>`;
}

function renderPage(
  snapshot: LibrarySnapshot,
  file: LibraryFile,
  options: BrainLibraryServerOptions,
  csrfNonce: string,
  cspNonce: string
): string {
  const brainFiles = snapshot.files.filter((item) => item.kind === "brain");
  const sourceFiles = snapshot.files.filter((item) => item.kind === "source");
  const content = renderMarkdown(file.markdown, file.repoPath);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(file.title)} · Brain Library</title><style>
  :root{--bg:#f3f0e9;--paper:#fffdf8;--ink:#252821;--muted:#676b62;--line:#d9d4c9;--accent:#405c4b;--accent2:#dfe9df;--shadow:0 18px 50px rgba(44,47,40,.08)}
  *{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--accent)}.shell{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;overflow:auto;padding:28px 22px;border-right:1px solid var(--line);background:color-mix(in srgb,var(--paper) 86%,transparent)}.brand{display:flex;align-items:center;gap:12px;margin-bottom:26px}.mark{width:38px;height:38px;border-radius:50% 50% 45% 55%;background:var(--accent);box-shadow:inset -9px -5px 0 rgba(255,255,255,.12)}.brand strong{display:block;font-family:ui-serif,Georgia,serif;font-size:18px}.brand small,.muted{color:var(--muted)}.nav-section{margin-top:24px}.nav-section h2,.eyebrow{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted)}.nav-section ul{list-style:none;margin:8px 0;padding:0}.nav-section a{display:block;padding:7px 10px;border-radius:8px;color:var(--ink);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nav-section a:hover,.nav-section a[aria-current=page]{background:var(--accent2);color:var(--accent)}.main{min-width:0;padding:34px}.topline{max-width:1120px;margin:0 auto 14px;color:var(--muted);font-size:13px}.reading-grid{max-width:1120px;margin:auto;display:grid;grid-template-columns:minmax(0,720px) minmax(260px,340px);gap:24px;align-items:start}.reading-grid>*{min-width:0}.paper,.source-panel{max-width:100%;background:var(--paper);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}.paper{padding:46px 52px;min-width:0}.paper h1,.paper h2,.paper h3{font-family:ui-serif,Georgia,serif;line-height:1.2;scroll-margin-top:20px}.paper h1{font-size:40px;margin-top:0}.paper h2{font-size:27px;margin-top:2em}.paper a{font-weight:600;text-decoration-thickness:1px;text-underline-offset:3px}.paper blockquote{margin:24px 0;padding:1px 20px;border-left:3px solid var(--accent);color:var(--muted);background:var(--accent2)}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em}code{overflow-wrap:anywhere}pre{max-width:100%;overflow:auto;padding:16px;border-radius:10px;background:#1f2621;color:#e7eee7}.paper img{max-width:100%}.paper table{display:block;overflow:auto;border-collapse:collapse}.paper td,.paper th{border:1px solid var(--line);padding:7px 10px}.source-panel{min-width:0;padding:24px;position:sticky;top:24px}.source-panel code{word-break:break-all}.source-panel h2{margin:.3em 0;font:24px/1.2 ui-serif,Georgia,serif}.chips{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.chips span{padding:3px 9px;border-radius:999px;background:var(--accent2);font-size:12px}.artifact{min-width:0;padding:16px 0;border-top:1px solid var(--line)}dl{display:grid;grid-template-columns:88px minmax(0,1fr);gap:4px 8px;margin:10px 0;font-size:12px}dt{color:var(--muted)}dd{margin:0;min-width:0;overflow-wrap:anywhere}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.action{border:0;border-radius:8px;background:var(--accent);color:white;padding:8px 11px;text-decoration:none;font:600 12px/1.2 inherit;cursor:pointer}.action.secondary{background:var(--accent2);color:var(--accent)}.action:disabled{opacity:.45;cursor:not-allowed}details{min-width:0;margin-top:18px}summary{cursor:pointer;font-weight:700}.status{min-height:22px;margin-top:9px;font-size:12px;color:var(--muted)}
  @media(max-width:920px){.shell{grid-template-columns:220px minmax(0,1fr)}.reading-grid{grid-template-columns:1fr}.source-panel{position:static}.paper{padding:36px}.main{padding:24px}}
  @media(max-width:620px){.shell{display:block}.sidebar{position:relative;width:100%;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:18px}.nav-section ul{display:flex;gap:6px;overflow:auto}.nav-section li{flex:0 0 auto}.nav-section a{max-width:220px}.main{padding:14px}.paper{padding:25px 20px;border-radius:12px}.paper h1{font-size:31px}.source-panel{padding:20px}.reading-grid{gap:14px}.topline{font-size:12px}}
  @media(prefers-color-scheme:dark){:root{--bg:#171a17;--paper:#20251f;--ink:#edf0e9;--muted:#aeb5aa;--line:#394039;--accent:#a7c7ad;--accent2:#2d3b31;--shadow:0 18px 50px rgba(0,0,0,.22)}}
  </style></head><body><div class="shell"><nav class="sidebar"><div class="brand"><span class="mark"></span><div><strong>Brain Library</strong><small>${escapeHtml(options.brainId)} · read-only</small></div></div>${navSection("Brain", brainFiles, file.repoPath)}${navSection("Sources", sourceFiles, file.repoPath)}</nav><main class="main"><div class="topline">${escapeHtml(file.repoPath)}</div><div class="reading-grid"><article class="paper">${content}</article>${sourcePanel(file, Boolean(options.allowLocalOpen))}</div><div class="status" id="status" aria-live="polite"></div></main></div><script nonce="${cspNonce}">
  document.addEventListener('click',async(event)=>{const button=event.target.closest('.local-open');if(!button)return;button.disabled=true;const status=document.getElementById('status');status.textContent='Opening local mirror…';try{const response=await fetch('/api/open-artifact',{method:'POST',headers:{'content-type':'application/json','x-brain-library-nonce':'${csrfNonce}'},body:JSON.stringify({artifactId:button.dataset.artifactId})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Open failed');status.textContent='Opened '+body.locator;}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
  </script></body></html>`;
}

export function createBrainLibraryServer(options: BrainLibraryServerOptions): http.Server {
  const csrfNonce = crypto.randomBytes(24).toString("hex");
  const cspNonce = crypto.randomBytes(18).toString("base64url");
  return http.createServer(async (request, response) => {
    securityHeaders(response, cspNonce);
    if (!isLoopbackHost(request)) {
      sendJson(response, 403, { error: "Brain Library accepts loopback Host headers only" });
      return;
    }
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, brainId: options.brainId, readOnly: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/open-artifact") {
        if (!options.allowLocalOpen) {
          sendJson(response, 403, { error: "Local artifact opening is disabled" });
          return;
        }
        if (request.headers["x-brain-library-nonce"] !== csrfNonce) {
          sendJson(response, 403, { error: "Invalid Brain Library nonce" });
          return;
        }
        if (String(request.headers["content-type"] || "").split(";", 1)[0] !== "application/json") {
          sendJson(response, 415, { error: "JSON content type is required" });
          return;
        }
        const body = (await readJson(request)) as { artifactId?: unknown };
        if (typeof body.artifactId !== "string") {
          sendJson(response, 400, { error: "artifactId is required" });
          return;
        }
        const snapshot = await loadLibrarySnapshot(options.brainRoot);
        const resolver = new ArtifactResolver(options.roots, snapshot.artifacts);
        const resolved = await resolver.resolve(body.artifactId);
        if (!options.openArtifact) throw new Error("No local artifact opener is configured");
        await options.openArtifact(resolved.absolutePath);
        sendJson(response, 200, {
          ok: true,
          artifactId: resolved.artifactId,
          locator: `${resolved.rootAlias}:${resolved.relativePath}`,
        });
        return;
      }
      if (request.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/view")) {
        sendJson(response, 404, { error: "Not found" });
        return;
      }
      const snapshot = await loadLibrarySnapshot(options.brainRoot);
      const requested = url.searchParams.get("file");
      const defaultFile =
        snapshot.files.find((file) => file.repoPath === "brain/00_loader.md") || snapshot.files[0];
      if (!defaultFile) throw new Error("Brain Library found no Markdown files");
      const file = requested ? await readLibraryFile(snapshot, requested) : defaultFile;
      const html = renderPage(snapshot, file, options, csrfNonce, cspNonce);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    } catch (error) {
      sendJson(response, 400, { error: String((error as Error)?.message || error) });
    }
  });
}
