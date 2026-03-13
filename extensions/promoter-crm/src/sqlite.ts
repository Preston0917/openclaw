import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type SqliteModule = typeof import("node:sqlite");

export function requireNodeSqlite(): SqliteModule {
  try {
    return require("node:sqlite") as SqliteModule;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `SQLite support is unavailable in this Node runtime (missing node:sqlite). ${message}`,
      { cause: err },
    );
  }
}
