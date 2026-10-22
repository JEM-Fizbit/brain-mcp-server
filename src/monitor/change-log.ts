import { parseLogEntries } from '../services/log.js';

export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function changeLogOptions(params: URLSearchParams) {
  const offset = params.get('offset') || '0';
  const kind = params.get('kind') || 'automatic';
  const q = (params.get('q') || '').trim();
  if (!/^\d{1,7}$/.test(offset) || Number(offset) > 1_000_000 ||
      !['automatic', 'all'].includes(kind) || q.length > 200) throw Error('invalid_change_filter');
  return { offset: Number(offset), kind, q };
}

/** Only link to the existing reader in this deployment and the selected Brain.
 * LOG is content, not authority to navigate to an arbitrary URL. */
function recordLink(entry: string, brainId: string, issuer: string): {href: string; revision: string} | null {
  const link = /^\[Full change and prior text\]\(([^\s)]+)\)$/m.exec(entry)?.[1];
  if (!link) return null;
  try {
    const url = new URL(link, issuer);
    const match = /^\/monitor\/changes\/([A-Za-z0-9_-]{1,160})$/.exec(url.pathname);
    if (url.origin !== new URL(issuer).origin || url.username || url.password || !match ||
        url.searchParams.get('brain_id') !== brainId) return null;
    return { href: url.pathname + '?brain_id=' + encodeURIComponent(brainId), revision: match[1] };
  } catch { return null; }
}

export function changeLogPage(content: string, brainId: string, issuer: string, options: ReturnType<typeof changeLogOptions>): string {
  const {offset, kind, q} = options;
  const entries = parseLogEntries(content).filter(entry =>
    (kind === 'all' || /^## \[\d{4}-\d{2}-\d{2}\] UPDATE \| Automatic source-backed update —/.test(entry)) &&
    (!q || entry.toLowerCase().includes(q.toLowerCase())));
  const page = entries.slice(offset, offset + 25);
  const href = (start: number) => '/monitor/changes?' + new URLSearchParams({brain_id: brainId, kind, q, offset: String(start)});
  const cards = page.map(entry => {
    const lines = entry.split('\n');
    const heading = lines[0].replace(/^## /, '');
    const field = (name: string) => lines.find(line => line.startsWith(name + ': '))?.slice(name.length + 2);
    const link = recordLink(entry, brainId, issuer);
    const author = /^(.*?); file: (.*)$/.exec(field('Agent') || '');
    const reason = field('Why') || heading.replace(/^\[.*?\] \w+ \| /, '');
    const stamp = /— (\d{4}-\d{2}-\d{2}T[^;]+);/.exec(heading)?.[1] || /^\[([^\]]+)\]/.exec(heading)?.[1] || '';
    const date = new Date(stamp);
    const when = Number.isFinite(date.getTime()) ? /^\d{4}-\d{2}-\d{2}$/.test(stamp)
      ? date.toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})
      : date.toLocaleString('en-GB', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}) + ' UTC' : stamp;
    const automatic = /^## \[\d{4}-\d{2}-\d{2}\] UPDATE \| Automatic source-backed update —/.test(entry);
    return '<article class="card history-entry"><p class="eyebrow">' + (automatic ? 'AUTOMATIC UPDATE' : 'LOG ENTRY') + '</p>' +
      '<h2>' + (link ? '<a href="' + escapeHtml(link.href) + '">' : '') + escapeHtml(reason.slice(0, 300)) + (link ? '</a>' : '') + '</h2>' +
      '<p><code>' + escapeHtml(author?.[2] || field('Files') || 'Brain maintenance') + '</code></p>' +
      '<p class="muted">' + escapeHtml(when) + (author ? ' · ' + escapeHtml(author[1]) : '') + '</p>' +
      (link ? '<p><a class="button" href="' + escapeHtml(link.href) + '">Open diff <code>' + escapeHtml(link.revision.slice(0, 8)) + '</code></a></p>' : '<p class="muted">Historical entry · no linked before/after record.</p>') +
      (field('Before') !== undefined ? '<div class="grid"><p><strong>− Before</strong><br>' + escapeHtml(field('Before')) + '</p><p><strong>+ After</strong><br>' + escapeHtml(field('After')) + '</p></div>' : '') +
      (field('Source') ? '<p class="muted">Source: ' + escapeHtml(field('Source')) + '</p>' : '') +
      '<details><summary>Log receipt</summary><pre>' + escapeHtml(entry) + '</pre></details></article>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brain change log</title><link rel="stylesheet" href="/monitor/style.css"></head><body><main>' +
    '<nav aria-label="Brain monitor"><a href="/monitor?brain_id=' + encodeURIComponent(brainId) + '">← Brain status</a></nav>' +
    '<header><div><p class="eyebrow">' + escapeHtml(brainId) + '</p><h1>Change log</h1><p>Browse changes, then open a revision to see its diff and sources. Manual review is optional.</p></div></header>' +
    '<form class="card change-filters" method="get" action="/monitor/changes"><input type="hidden" name="brain_id" value="' + escapeHtml(brainId) + '">' +
    '<label>Show<select name="kind"><option value="automatic"' + (kind === 'automatic' ? ' selected' : '') + '>Automatic updates</option><option value="all"' + (kind === 'all' ? ' selected' : '') + '>All entries</option></select></label>' +
    '<label>Search<input name="q" type="search" maxlength="200" placeholder="File, reason or source" value="' + escapeHtml(q) + '"></label><button type="submit">Apply filters</button></form>' +
    '<p class="muted">Newest first · ' + entries.length + ' matching ' + (entries.length === 1 ? 'entry' : 'entries') + (page.length ? ' · Showing ' + (offset + 1) + '–' + (offset + page.length) : '') + '</p>' +
    (cards || '<section class="card"><h2>No matching entries</h2><p>Try All entries or clear your search. Older receipts may not have linked before/after records.</p></section>') +
    '<nav class="toolbar" aria-label="Change log pages">' + (offset > 0 ? '<a class="button" href="' + escapeHtml(href(Math.max(0, offset - 25))) + '">Newer</a>' : '') +
    (offset + 25 < entries.length ? '<a class="button" href="' + escapeHtml(href(offset + 25)) + '">Older</a>' : '') +
    '</nav><footer>Read-only change history · Access follows your current Brain role. The list labels receipt types; full records show verification scope.</footer></main></body></html>';
}
