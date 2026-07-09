/**
 * Wikilink integrity for rename/delete (spec 011, addresses review-1 #7).
 *
 * Link forms handled (empirically the ones ERS/JEM brains use):
 *   [[basename]]              bare, extensionless
 *   [[basename|Alias]]        plain-pipe alias
 *   [[basename\|Alias]]       escaped-pipe alias (markdown table context)
 *   [[basename#Heading]]      heading/block anchor
 *   [[rel/path/basename]]     path-qualified
 * Rewrites are basename-based when the basename is unique in the brain; a
 * non-unique (colliding) basename is left untouched and flagged ambiguous
 * (Obsidian would path-qualify — we refuse to guess and mis-point a link).
 * Path-qualified links are rewritten on an exact path match, always.
 */

export interface FileEntry {
  name: string;
  content: string;
}

const WIKILINK_RE = /\[\[([^[\]]+?)\]\]/g;

function baseNoExt(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

function pathNoExt(filePath: string): string {
  return filePath.endsWith(".md") ? filePath.slice(0, -3) : filePath;
}

/** Split a wikilink inner into its target and the preserved suffix (#anchor + alias). */
function splitInner(inner: string): { target: string; suffix: string } {
  const escaped = inner.indexOf("\\|");
  const plain = inner.indexOf("|");
  let aliasIdx = -1;
  if (escaped !== -1 && (plain === -1 || escaped <= plain)) aliasIdx = escaped;
  else if (plain !== -1) aliasIdx = plain;

  const head = aliasIdx === -1 ? inner : inner.slice(0, aliasIdx);
  const aliasPart = aliasIdx === -1 ? "" : inner.slice(aliasIdx);
  const hashIdx = head.indexOf("#");
  const target = hashIdx === -1 ? head : head.slice(0, hashIdx);
  const anchor = hashIdx === -1 ? "" : head.slice(hashIdx);
  return { target: target.trim(), suffix: anchor + aliasPart };
}

function basenameUniqueIn(files: FileEntry[], base: string): boolean {
  let count = 0;
  for (const file of files) {
    if (baseNoExt(file.name) === base) count += 1;
    if (count > 1) return false;
  }
  return true;
}

interface RewriteResult {
  content: string;
  changed: boolean;
  ambiguous: boolean;
}

function rewriteContent(
  content: string,
  fromPath: string,
  toPath: string,
  basenameUnique: boolean
): RewriteResult {
  const fromBase = baseNoExt(fromPath);
  const toBase = baseNoExt(toPath);
  const fromPathNoExt = pathNoExt(fromPath);
  const toPathNoExt = pathNoExt(toPath);
  let changed = false;
  let ambiguous = false;

  const out = content.replace(WIKILINK_RE, (whole, inner: string) => {
    const { target, suffix } = splitInner(inner);
    if (target.includes("/")) {
      if (target === fromPathNoExt) {
        changed = true;
        return `[[${toPathNoExt}${suffix}]]`;
      }
      return whole;
    }
    if (target === fromBase) {
      if (basenameUnique) {
        changed = true;
        return `[[${toBase}${suffix}]]`;
      }
      ambiguous = true;
    }
    return whole;
  });

  return { content: out, changed, ambiguous };
}

/**
 * Rewrite every inbound wikilink that points at `fromPath` to `toPath`, across
 * all files (excluding the renamed file itself). Returns only the files that
 * changed, plus whether a basename collision forced any skips.
 */
export function rewriteInboundLinks(
  files: FileEntry[],
  fromPath: string,
  toPath: string
): { updates: FileEntry[]; ambiguous: boolean } {
  const unique = basenameUniqueIn(files, baseNoExt(fromPath));
  const updates: FileEntry[] = [];
  let ambiguous = false;
  for (const file of files) {
    if (file.name === fromPath) continue;
    const result = rewriteContent(file.content, fromPath, toPath, unique);
    if (result.ambiguous) ambiguous = true;
    if (result.changed) updates.push({ name: file.name, content: result.content });
  }
  return { updates, ambiguous };
}

/** List files that contain an inbound wikilink resolving to `targetPath`. */
export function findInboundLinkFiles(
  files: FileEntry[],
  targetPath: string
): string[] {
  const unique = basenameUniqueIn(files, baseNoExt(targetPath));
  const base = baseNoExt(targetPath);
  const targetPathNoExt = pathNoExt(targetPath);
  const result: string[] = [];
  for (const file of files) {
    if (file.name === targetPath) continue;
    let hit = false;
    file.content.replace(WIKILINK_RE, (whole, inner: string) => {
      const { target } = splitInner(inner);
      if (target.includes("/")) {
        if (target === targetPathNoExt) hit = true;
      } else if (target === base && unique) {
        hit = true;
      }
      return whole;
    });
    if (hit) result.push(file.name);
  }
  return result;
}
