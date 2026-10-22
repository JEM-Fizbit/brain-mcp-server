export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** A user-clicked route back to a local cockpit, never a redirect or an API call. */
export function safeCockpitUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 200) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) ||
        !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function withCockpit(href: string, cockpit?: string): string {
  if (!cockpit) return href;
  const url = new URL(href, 'https://monitor.invalid');
  url.searchParams.set('return_to', cockpit);
  return url.pathname + url.search;
}

export function cockpitButton(cockpit?: string): string {
  return cockpit ? '<a class="button" href="' + escapeHtml(cockpit) + '">← Back to cockpit</a> ' : '';
}
