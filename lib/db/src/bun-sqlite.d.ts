/**
 * Minimal type declarations for Bun's built-in `bun:sqlite` module.
 *
 * The project runs exclusively on bun + bm2 (no node), and uses
 * `bun:sqlite`'s DatabaseSync API (same shape as node:sqlite) for the
 * local SQLite fallback database. Bun ships its own runtime types, but
 * TypeScript (via tsc) can't resolve `bun:sqlite` unless bundler types are
 * present — these declarations cover exactly what local-sqlite-pool.ts uses.
 */

declare module "bun:sqlite" {
  export interface Statement<Params extends unknown[] = unknown[], Return = unknown> {
    all(...params: Params): Return;
    run(...params: Params): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: Params): Return | undefined;
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean; create?: boolean });
    exec(sql: string): void;
    prepare<Params extends unknown[] = unknown[], Return = unknown>(
      sql: string,
    ): Statement<Params, Return>;
    close(): void;
  }
}