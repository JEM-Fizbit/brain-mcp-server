export function accessAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ERS Brain · Access & Roles</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17211b;
      --muted: #667069;
      --line: #d9ded9;
      --paper: #fbfcfa;
      --panel: #fff;
      --control: #fff;
      --soft: #edf2ee;
      --green: #1e6a46;
      --green-action: #1e6a46;
      --amber: #926400;
      --red: #a32929;
      --blue: #275d9b;
      --error-bg: #fff3f3;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { padding: 20px 28px; border-bottom: 1px solid var(--line); background: var(--panel); display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    h1 { font-size: 20px; margin: 0; }
    header p { margin: 2px 0 0; color: var(--muted); }
    main { max-width: 1440px; margin: auto; padding: 24px 28px 48px; }
    .toolbar, .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
    .toolbar { padding: 14px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .card { margin-top: 18px; padding: 18px; }
    .card-heading { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    h2 { font-size: 16px; margin: 0 0 12px; }
    h3 { font-size: 14px; margin: 0 0 4px; }
    button, select, input, textarea { font: inherit; color: var(--ink); }
    button { border: 1px solid #9ba79e; border-radius: 7px; background: var(--control); padding: 7px 11px; cursor: pointer; }
    button.primary, .primary-link { background: var(--green-action); border: 1px solid var(--green-action); border-radius: 7px; color: #fff; padding: 7px 11px; text-decoration: none; }
    button.danger { color: var(--red); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
    input, select, textarea { border: 1px solid #9ba79e; border-radius: 7px; padding: 8px; background: var(--control); }
    input[type=search] { min-width: 300px; }
    .muted { color: var(--muted); }
    .status { margin-left: auto; }
    .ok { color: var(--green); }
    .warn { color: var(--amber); }
    .fail { color: var(--red); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-top: 1px solid var(--line); vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    code { font-size: 12px; }
    .pill { display: inline-block; padding: 2px 7px; border-radius: 999px; background: var(--soft); }
    .drift-none { color: var(--green); }
    .drift-multiple, .drift-mismatch, .drift-unexpected, .drift-missing { color: var(--red); }
    .role-guide { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
    .role-guide-item { border: 1px solid var(--line); border-radius: 8px; padding: 11px; background: var(--paper); }
    .role-guide-item p { margin: 0; color: var(--muted); font-size: 13px; }
    .help-panel { margin: 12px 0 14px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--paper); }
    .help-panel summary { cursor: pointer; font-weight: 650; }
    .help-panel p { margin: 8px 0 0; color: var(--muted); }
    .role-help { margin: 5px 0 0; color: var(--muted); font-size: 13px; min-height: 2.8em; }
    .reconcile-context { border-left: 3px solid var(--amber); padding: 8px 10px; background: var(--paper); }
    dialog { width: min(640px, calc(100% - 32px)); border: 1px solid var(--line); border-radius: 10px; padding: 0; background: var(--panel); color: var(--ink); }
    dialog::backdrop { background: #17211b66; }
    .dialog-body { padding: 20px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .fields label { display: flex; flex-direction: column; gap: 4px; }
    .fields .wide { grid-column: 1 / -1; }
    .results { margin: 10px 0 0; padding: 0; list-style: none; }
    .results button { width: 100%; text-align: left; margin-top: 6px; }
    .error { padding: 10px; border-left: 3px solid var(--red); background: var(--error-bg); }
    .dialog-error { margin: 12px 0 0; }
    .hidden { display: none; }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --ink: #eef3ef;
        --muted: #abb6ae;
        --line: #3b453d;
        --paper: #101410;
        --panel: #181d19;
        --control: #222823;
        --soft: #29322b;
        --green: #70d49f;
        --green-action: #267a54;
        --amber: #e6bd61;
        --red: #ff8989;
        --blue: #7eb4f0;
        --error-bg: #351f1f;
      }
      button, input, select, textarea { border-color: #5a665c; }
    }
    @media (max-width: 900px) { .role-guide { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) {
      header, main { padding-left: 16px; padding-right: 16px; }
      .status { width: 100%; margin-left: 0; }
      .fields, .role-guide { grid-template-columns: 1fr; }
      input[type=search] { min-width: 0; width: 100%; }
      .table-wrap { overflow: auto; }
      .card-heading { align-items: stretch; }
    }
  </style>
</head>
<body>
<header>
  <div><h1>ERS Brain · Access & Roles</h1><p>Hosted Owner control plane · deployment-bound to ers-brain</p></div>
  <button id="signout" class="hidden">End admin session</button>
</header>
<main>
  <section class="toolbar">
    <strong id="identity">Checking admin session…</strong>
    <span id="expiry" class="muted"></span>
    <span id="status" class="status muted">Loading</span>
    <a id="signin" class="hidden primary-link" href="/admin/login">Sign in with Microsoft</a>
  </section>
  <div id="error" class="card error hidden" role="alert"></div>
  <section id="controls" class="hidden">
    <div class="card">
      <h2>Add or change access</h2>
      <p class="muted">Search the ERS directory, then confirm exactly one managed role. Reader is the safe default.</p>
      <div class="role-guide" aria-label="ERS Brain role guide">
        <div class="role-guide-item"><h3>Reader</h3><p>Searches and reads Brain content and status. Cannot change content.</p></div>
        <div class="role-guide-item"><h3>Curator</h3><p>Reader access plus ordinary, non-structural content updates.</p></div>
        <div class="role-guide-item"><h3>Admin</h3><p>Curator access plus structural, recovery, and conflict operations. Cannot manage access.</p></div>
        <div class="role-guide-item"><h3>Owner</h3><p>Admin-level content authority plus access administration and governance responsibility.</p></div>
      </div>
      <div><input id="search" type="search" placeholder="Name or ERS email" autocomplete="off"><button id="searchBtn">Search directory</button></div>
      <ul id="results" class="results"></ul>
    </div>
    <div class="card">
      <div class="card-heading"><div><h2>Effective grants</h2><p class="muted">Local Brain enforcement compared with the four live managed Entra role groups.</p></div><button id="refresh">Refresh</button></div>
      <details class="help-panel">
        <summary>What does “Review &amp; reconcile” mean?</summary>
        <p>It appears when the audited local grant and Microsoft Entra group membership do not match, or when the Entra check is unavailable. Opening it does not change anything. The confirmation form starts with the local role and status; an Owner must review the evidence and explicitly confirm the intended state. Confirmation updates the fixed Entra groups and audited local grant using fail-closed ordering. The system never chooses a role automatically.</p>
      </details>
      <p class="muted">Legacy GitHub fallback grants are shown for visibility but are not managed on this Entra page.</p>
      <div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Entra check</th><th>Updated</th><th>Action</th></tr></thead><tbody id="grants"></tbody></table></div>
    </div>
    <div class="card"><h2>Audit history</h2><div class="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Target</th><th>Change</th><th>Graph</th><th>Reason</th></tr></thead><tbody id="audit"></tbody></table></div></div>
  </section>
</main>
<dialog id="changeDialog" aria-labelledby="dialogTitle">
  <div class="dialog-body">
    <h2 id="dialogTitle">Confirm access change</h2>
    <p id="targetLabel"></p>
    <p id="changeContext" class="reconcile-context hidden"></p>
    <div id="dialogError" class="error dialog-error hidden" role="alert"></div>
    <div class="fields">
      <label>Role
        <select id="role" aria-describedby="roleHelp"><option value="reader">Reader</option><option value="member">Curator</option><option value="admin">Admin</option><option value="owner">Owner</option></select>
        <span id="roleHelp" class="role-help" aria-live="polite"></span>
      </label>
      <label>Status<select id="grantStatus"><option value="active">Active</option><option value="suspended">Suspended</option><option value="revoked">Revoked</option></select></label>
      <label class="wide">Reason<textarea id="reason" rows="2" maxlength="500">Owner-confirmed access change</textarea></label>
    </div>
    <p class="muted">Confirmation changes both the audited local Brain grant and fixed Entra managed-group membership. Revocation and downgrade take effect locally first.</p>
    <div class="dialog-actions"><button id="cancel">Cancel</button><button id="confirm" class="primary">Confirm change</button></div>
  </div>
</dialog>
<script>
let csrf = "", selected = null;
const $ = id => document.getElementById(id);
const roleDescriptions = {
  reader: "Can search and read Brain content and status. Cannot change content.",
  member: "Can read and make ordinary, non-structural content updates. Cannot perform structural, recovery, conflict, or access administration.",
  admin: "Can perform content, structural, recovery, and conflict operations. Cannot grant or revoke user access.",
  owner: "Has Admin-level content authority and can manage user access. Reserve this role for the small accountable Owner group."
};
function showError(message) { $("error").textContent = message; $("error").classList.remove("hidden"); }
function clearError() { $("error").classList.add("hidden"); $("error").textContent = ""; }
function showDialogError(message) { $("dialogError").textContent = message; $("dialogError").classList.remove("hidden"); }
function clearDialogError() { $("dialogError").classList.add("hidden"); $("dialogError").textContent = ""; }
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) { headers["content-type"] = "application/json"; headers["x-brain-csrf"] = csrf; }
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({ error: "Unexpected server response" }));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function td(text) { const cell = document.createElement("td"); cell.textContent = text == null ? "—" : String(text); return cell; }
function roleLabel(role) { return role === "member" ? "Curator" : role.charAt(0).toUpperCase() + role.slice(1); }
function updateRoleHelp() { $("roleHelp").textContent = roleDescriptions[$("role").value] || ""; }
function entraCheck(grant) {
  if (grant.provider !== "entra") return { text: "GitHub fallback · not managed here", className: "muted" };
  const roles = grant.graphRoles.map(roleLabel).join(", ");
  if (grant.drift === "none") return { text: roles ? "Matched · " + roles : "Matched · no Entra role", className: "drift-none" };
  if (grant.drift === "missing") return { text: "Missing in Entra · expected " + roleLabel(grant.role), className: "drift-missing" };
  if (grant.drift === "multiple") return { text: "Multiple Entra roles · " + (roles || "unknown"), className: "drift-multiple" };
  if (grant.drift === "mismatch") return { text: "Entra " + (roles || "unknown") + " · local " + roleLabel(grant.role), className: "drift-mismatch" };
  if (grant.drift === "unexpected") return { text: "Unexpected Entra role · " + (roles || "unknown"), className: "drift-unexpected" };
  return { text: "Entra check unavailable", className: "warn" };
}
function openChange(target, grant, mode = "change") {
  selected = { target, mode };
  clearDialogError();
  $("targetLabel").textContent = target.displayName || target.name || target.mail || target.email || target.id;
  $("role").value = grant?.role || "reader";
  $("grantStatus").value = grant?.status || "active";
  const reconciling = mode === "reconcile";
  $("dialogTitle").textContent = reconciling ? "Review and reconcile access" : "Confirm access change";
  $("confirm").textContent = reconciling ? "Confirm intended access" : "Confirm change";
  $("reason").value = reconciling ? "Owner-reviewed Entra reconciliation" : "Owner-confirmed access change";
  $("changeContext").classList.toggle("hidden", !reconciling);
  $("changeContext").textContent = reconciling
    ? "A mismatch or unavailable Entra check was detected. Nothing changes until you confirm the intended role and status below."
    : "";
  updateRoleHelp();
  $("changeDialog").showModal();
}
async function load() {
  clearError();
  const session = await api("/admin/api/session").catch(error => ({ authenticated: false, error: error.message }));
  if (!session.authenticated) { $("identity").textContent = "Owner sign-in required"; $("status").textContent = "No active admin session"; $("signin").classList.remove("hidden"); return; }
  csrf = session.csrfToken;
  $("identity").textContent = session.name || session.login || session.objectId;
  $("expiry").textContent = "Session expires " + new Date(session.expiresAt * 1000).toLocaleTimeString();
  $("status").textContent = "Owner session active";
  $("status").className = "status ok";
  $("controls").classList.remove("hidden");
  $("signout").classList.remove("hidden");
  await refresh();
}
async function refresh() {
  clearError();
  $("status").textContent = "Refreshing…";
  try {
    const data = await api("/admin/api/access");
    const body = $("grants");
    body.replaceChildren();
    for (const grant of data.grants) {
      const row = document.createElement("tr");
      const check = entraCheck(grant);
      const checkCell = td(check.text);
      checkCell.className = check.className;
      row.append(td(grant.name || grant.email || grant.providerUserId), td(roleLabel(grant.role)), td(grant.status), checkCell, td(grant.updatedAt ? new Date(grant.updatedAt).toLocaleString() : "—"));
      const action = td("");
      if (grant.provider === "entra") {
        const button = document.createElement("button");
        const reconciling = grant.drift !== "none";
        button.textContent = reconciling ? "Review & reconcile" : "Change";
        button.onclick = () => openChange({ id: grant.providerUserId, displayName: grant.name, mail: grant.email, userPrincipalName: grant.email }, grant, reconciling ? "reconcile" : "change");
        action.replaceChildren(button);
      } else {
        action.textContent = "Not managed here";
        action.className = "muted";
      }
      row.append(action);
      body.append(row);
    }
    const audit = $("audit");
    audit.replaceChildren();
    for (const event of data.audit) {
      const row = document.createElement("tr");
      row.append(td(new Date(event.createdAt).toLocaleString()), td(event.actorUserId), td(event.targetName || event.targetUserId), td(event.action + " · " + (event.oldRole || "—") + " → " + (event.newRole || "—") + " · " + (event.newStatus || "—")), td(event.graphOutcome || "—"), td(event.reason || "—"));
      audit.append(row);
    }
    $("status").textContent = "Current";
    $("status").className = "status ok";
  } catch (error) {
    showError(error.message);
    $("status").textContent = "Needs attention";
    $("status").className = "status fail";
  }
}
$("searchBtn").onclick = async () => {
  clearError();
  try {
    const data = await api("/admin/api/users?q=" + encodeURIComponent($("search").value));
    const list = $("results");
    list.replaceChildren();
    for (const user of data.users) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = (user.displayName || user.userPrincipalName || user.id) + (user.mail ? " · " + user.mail : "");
      button.onclick = () => openChange(user, null);
      item.append(button);
      list.append(item);
    }
  } catch (error) { showError(error.message); }
};
$("role").onchange = updateRoleHelp;
$("refresh").onclick = refresh;
$("cancel").onclick = () => $("changeDialog").close();
$("confirm").onclick = async () => {
  if (!selected) return;
  $("confirm").disabled = true;
  clearDialogError();
  try {
    await api("/admin/api/access", { method: "POST", body: JSON.stringify({ target: selected.target, role: $("role").value, status: $("grantStatus").value, reason: $("reason").value, confirmed: true }) });
    $("changeDialog").close();
    await refresh();
  } catch (error) { showDialogError(error.message); }
  finally { $("confirm").disabled = false; }
};
$("signout").onclick = async () => { await api("/admin/api/logout", { method: "POST", body: "{}" }).catch(() => {}); location.reload(); };
load().catch(error => showError(error.message));
</script>
</body></html>`;
}
