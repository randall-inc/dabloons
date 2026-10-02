/**
 * Minimal database interface both runtimes implement.
 * SQL is written with `?` placeholders; the Postgres adapter rewrites them
 * to $1, $2, ... Keep SQL standard (no dialect-specific DML).
 */
export interface TxDb {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends TxDb {
  transaction<T>(fn: (tx: TxDb) => Promise<T>): Promise<T>;
  close(): Promise<void> | void;
}
