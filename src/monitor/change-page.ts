const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function observedTime(value: unknown): string {
    const date = new Date(String(value));
    return Number.isFinite(date.getTime())
        ? date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC"
        : String(value ?? "Not recorded");
}
function sourceItem(evidence: Record<string, unknown>): string {
    let reference = "<code>" + escape(evidence.reference) + "</code>";
    try {
        const url = new URL(String(evidence.reference));
        if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) {
            reference = '<a href="' + escape(url.href) + '" rel="noreferrer noopener">' + escape(evidence.reference) + "</a>";
        }
    }
    catch { /* Brain-relative references stay readable without inventing a URL. */ }
    const scope = evidence.verification === "retrieved"
        ? "Checked against the current Brain source."
        : evidence.method === "user_instruction"
            ? "Direct user instruction, recorded by the agent."
            : "Agent-observed source; not independently retrieved by this server.";
    return '<section class="card"><p><strong>Source:</strong> ' + reference + "</p><p>" +
        escape(scope) + "</p><p>Observed " + escape(observedTime(evidence.observed_at)) +
        " · Revision/hash: " + escape(evidence.revision || evidence.sha256 || "direct instruction") +
        "</p><details><summary>Supporting passage</summary><pre>" + escape(evidence.excerpt) + "</pre></details></section>";
}
export function changePage(record: Record<string, any>): string {
    const context = record.context || {};
    const evidence: Record<string, unknown>[] = context.evidence || [];
    const status = record.phase && record.phase !== "complete" ? record.result : context.verification || record.result;
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brain change</title><link rel="stylesheet" href="/monitor/style.css"></head><body><main>' +
        "<h1>" + escape(record.filename) + "</h1><p>" + escape(record.brain_id) + " · " +
        escape(observedTime(record.observed_at)) + " · " + escape(record.actor?.name || record.actor?.id || "Unattributed") + "</p>" +
        "<p>Result: " + escape(status || "historical revision; no automatic verification record") +
        ". Manual review is optional.</p><p>" + escape(context.reason || "Retained revision") + "</p>" +
        "<h2>Sources and verification scope</h2>" +
        (evidence.length ? evidence.map(sourceItem).join("") : "<p>No source evidence recorded for this historical revision.</p>") +
        "<h2>Before</h2><pre>" + escape(record.before || "(No prior text)") + "</pre>" +
        "<h2>After</h2><pre>" + escape(record.after || "(No text)") + "</pre>" +
        "<p>" + escape(record.note) + '</p><p><a href="/monitor">Brain status</a></p></main></body></html>';
}
