import { structuredPatch } from 'diff';
import { escapeHtml as escape } from './change-log.js';

/** Bounded presentation only; original snapshots always remain available. */
export function changeDiff(before: string, after: string, filename: string): string {
  if (before === after) return '<p>No text changes.</p>';
  if (before.length + after.length > 500_000 || before.split('\n').length + after.split('\n').length > 20_000) {
    return '<p>Diff is too large to display. Read the full before and after text below.</p>';
  }
  const patch = structuredPatch('a/' + filename, 'b/' + filename, before, after, undefined, undefined,
    {context: 3, timeout: 150, maxEditLength: 5000});
  if (!patch) return '<p>Diff exceeded the display limit. Read the full before and after text below.</p>';
  let added = 0, removed = 0;
  const hunks = patch.hunks.map(hunk => {
    let oldLine = hunk.oldStart, newLine = hunk.newStart;
    const rows = hunk.lines.map(line => {
      const marker = line[0];
      const kind = marker === '+' ? 'added' : marker === '-' ? 'removed' : marker === ' ' ? 'context' : 'note';
      const oldNumber = ['-', ' '].includes(marker) ? oldLine++ : '';
      const newNumber = ['+', ' '].includes(marker) ? newLine++ : '';
      if (kind === 'added') added++;
      if (kind === 'removed') removed++;
      return '<tr class="diff-' + kind + '"><td class="line-number">' + oldNumber + '</td><td class="line-number">' + newNumber +
        '</td><td class="diff-marker">' + escape(marker) + '</td><td class="diff-text">' + escape(line.slice(1)) + '</td></tr>';
    }).join('');
    return '<tr class="diff-hunk"><td colspan="4">@@ −' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@</td></tr>' + rows;
  }).join('');
  return '<p class="diff-stats"><strong>+' + added + ' added</strong> · <strong>−' + removed + ' removed</strong> · Three context lines around each change</p>' +
    '<div class="diff-container"><table class="diff-table" aria-label="Line-by-line changes"><thead><tr><th scope="col">Old</th><th scope="col">New</th><th scope="col">±</th><th scope="col">Text</th></tr></thead><tbody>' + hunks + '</tbody></table></div>';
}
