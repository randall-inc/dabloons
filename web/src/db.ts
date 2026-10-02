import { Client } from "pg";
import type { Db, TxDb } from "../../shared/db.ts";

/** Rewrite `?` placeholders to $1, $2, ... for Postgres. */
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * node-postgres adapter. One client per request: connect, use, close —
 * the required pattern on Workers. Locally it points at any Postgres;
 * in production the connection string comes from the Hyperdrive binding.
 */
export class PgDb implements Db {
  private client: Client;
  private connected = false;

  constructor(connectionString: string) {
    // Bounded, so a stalled connect or query fails fast (a 500 the client can
    // retry, idempotency key and all) instead of hanging the request.
    this.client = new Client({ connectionString, connectionTimeoutMillis: 10_000, query_timeout: 20_000 });
  }

  private async ensure(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.ensure();
    const res = await this.client.query(toPg(sql), params as any[]);
    return res.rows as T[];
  }

  async transaction<T>(fn: (tx: TxDb) => Promise<T>): Promise<T> {
    await this.ensure();
    const tx: TxDb = { query: (sql, params = []) => this.query(sql, params) };
    await this.client.query("BEGIN");
    try {
      const result = await fn(tx);
      await this.client.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await this.client.query("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw e;
    }
  }

  async close(): Promise<void> {
    if (this.connected) {
      this.connected = false;
      await this.client.end();
    }
  }
}
