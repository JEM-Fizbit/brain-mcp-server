import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export type OauthStore =
  | "clients"
  | "auth_codes"
  | "refresh_tokens"
  | "oauth_states";

export interface StateProvider {
  get(store: OauthStore, key: string): Promise<any | null>;
  put(store: OauthStore, key: string, value: any): Promise<any>;
  del(store: OauthStore, key: string): Promise<boolean>;
  consumeOnce(store: OauthStore, key: string): Promise<any | null>;
  listAll(store: OauthStore): Promise<Record<string, any>>;
}

function defaultRoot(): string {
  return (
    process.env.BRAIN_PLATFORM_STATE_ROOT ||
    path.join(os.homedir(), ".config", "brain-platform", "state")
  );
}

function sweepExpired(entries: Record<string, any>): Record<string, any> {
  const now = Math.floor(Date.now() / 1000);
  for (const [key, value] of Object.entries(entries)) {
    if (value && typeof value.expires_at === "number" && value.expires_at < now) {
      delete entries[key];
    }
  }
  return entries;
}

class LockTable {
  private locks = new Map<string, Promise<void>>();

  async with<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(name) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(name, previous.then(() => next));
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(name) === next) this.locks.delete(name);
    }
  }
}

export function makeFileStateProvider(root = defaultRoot()): StateProvider {
  const locks = new LockTable();

  function storePath(store: OauthStore): string {
    return path.join(root, "oauth", `${store}.json`);
  }

  async function load(store: OauthStore): Promise<Record<string, any>> {
    try {
      const raw = await fs.readFile(storePath(store), "utf-8");
      const parsed = JSON.parse(raw);
      return sweepExpired(parsed.entries || {});
    } catch (error: any) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
  }

  async function save(store: OauthStore, entries: Record<string, any>): Promise<void> {
    const filePath = storePath(store);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ entries }, null, 2), "utf-8");
    await fs.rename(tmp, filePath);
  }

  return {
    async get(store, key) {
      const entries = await load(store);
      return entries[key] || null;
    },

    async put(store, key, value) {
      return locks.with(store, async () => {
        const entries = await load(store);
        entries[key] = value;
        await save(store, entries);
        return value;
      });
    },

    async del(store, key) {
      return locks.with(store, async () => {
        const entries = await load(store);
        const had = key in entries;
        delete entries[key];
        if (had) await save(store, entries);
        return had;
      });
    },

    async consumeOnce(store, key) {
      return locks.with(store, async () => {
        const entries = await load(store);
        const value = entries[key] || null;
        if (value) {
          delete entries[key];
          await save(store, entries);
        }
        return value;
      });
    },

    async listAll(store) {
      return load(store);
    },
  };
}
