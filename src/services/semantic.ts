import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { listSources, readFile } from "./brain.js";
import { getBrainPaths } from "./registry.js";

const VECTOR_DIM = 128;
const MAX_CHUNK_CHARS = 1800;
const INDEX_VERSION = 1;

export interface SemanticSearchResult {
  filename: string;
  chunkId: string;
  score: number;
  heading: string | null;
  text: string;
}

interface IndexedChunk extends SemanticSearchResult {
  hash: string;
  vector: number[];
}

interface SemanticIndexFile {
  version: number;
  indexed_at: string;
  scope: "sources";
  chunks: IndexedChunk[];
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function tokenSlot(token: string): number {
  const digest = createHash("sha256").update(token).digest();
  return digest.readUInt32BE(0) % VECTOR_DIM;
}

function embed(text: string): number[] {
  const vector = Array.from({ length: VECTOR_DIM }, () => 0);
  for (const token of tokenise(text)) {
    vector[tokenSlot(token)] += 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

function dot(a: number[], b: number[]): number {
  let score = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    score += a[i] * b[i];
  }
  return score;
}

async function indexPath(brainId: string): Promise<string> {
  const { repoPath } = await getBrainPaths(brainId);
  return path.join(repoPath, ".brain-platform", "semantic-sources.json");
}

function chunkMarkdown(filename: string, content: string): Omit<IndexedChunk, "vector">[] {
  const chunks: Omit<IndexedChunk, "vector">[] = [];
  const headingStack: string[] = [];
  let current: string[] = [];
  let ordinal = 0;

  function flush(): void {
    const text = current.join("\n").trim();
    if (!text) return;
    ordinal += 1;
    const heading = headingStack.length > 0 ? headingStack.join(" > ") : null;
    chunks.push({
      filename,
      chunkId: `${filename}#${ordinal}`,
      score: 0,
      heading,
      text,
      hash: hashText(`${filename}\n${heading || ""}\n${text}`),
    });
    current = [];
  }

  for (const line of content.split("\n")) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = heading[2].trim();
      current.push(line);
      continue;
    }

    if (current.join("\n").length + line.length + 1 > MAX_CHUNK_CHARS) {
      flush();
    }
    current.push(line);
  }
  flush();

  return chunks;
}

async function writeIndex(filePath: string, index: SemanticIndexFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

async function readIndex(filePath: string): Promise<SemanticIndexFile | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as SemanticIndexFile;
    if (parsed.version !== INDEX_VERSION || parsed.scope !== "sources") return null;
    if (!Array.isArray(parsed.chunks)) return null;
    return parsed;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  indexPath: string;
}

export async function indexSources(brainId: string): Promise<IndexResult> {
  const files = await listSources(undefined, brainId);
  const chunks: IndexedChunk[] = [];
  let skipped = 0;

  for (const filename of files) {
    try {
      const content = await readFile(filename, "sources", brainId);
      for (const chunk of chunkMarkdown(filename, content)) {
        chunks.push({ ...chunk, vector: embed(chunk.text) });
      }
    } catch {
      skipped += 1;
    }
  }

  const filePath = await indexPath(brainId);
  await writeIndex(filePath, {
    version: INDEX_VERSION,
    indexed_at: new Date().toISOString(),
    scope: "sources",
    chunks,
  });

  return { indexed: chunks.length, skipped, indexPath: filePath };
}

export async function semanticSearch(
  brainId: string,
  query: string,
  topK = 5
): Promise<SemanticSearchResult[]> {
  const filePath = await indexPath(brainId);
  let index = await readIndex(filePath);
  if (!index) {
    await indexSources(brainId);
    index = await readIndex(filePath);
  }
  if (!index) return [];

  const queryVector = embed(query);
  if (queryVector.every((value) => value === 0)) return [];

  return index.chunks
    .map((chunk) => ({
      filename: chunk.filename,
      chunkId: chunk.chunkId,
      score: dot(queryVector, chunk.vector),
      heading: chunk.heading,
      text: chunk.text,
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, Math.floor(topK))));
}
