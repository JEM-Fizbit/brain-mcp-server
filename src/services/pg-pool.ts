type ErrorEmitting = {
  on(event: "error", listener: (error: Error) => void): unknown;
};

/**
 * node-postgres emits "error" on the Pool when an idle client dies (e.g. the
 * pooler terminates a connection). Without a listener that is an unhandled
 * EventEmitter error and crashes the process. Attach at every Pool
 * construction site.
 */
export function attachPoolErrorLogger<T extends ErrorEmitting>(
  pool: T,
  label: string
): T {
  pool.on("error", (error) => {
    console.error(`[pg-pool:${label}] idle client error`, error);
  });
  return pool;
}
