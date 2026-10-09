/**
 * Server-side database connection for Next.js API routes.
 * Uses a module-level singleton so the pool is reused across hot reloads in dev.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema";
import { createDatabaseClient } from "../../db/connection";

declare global {
  // eslint-disable-next-line no-var
  var _pgSql: postgres.Sql | undefined;
}

function createSql() {
  return createDatabaseClient({ max: 5 });
}

export const sql: postgres.Sql =
  global._pgSql ?? (global._pgSql = createSql());

export const db = drizzle(sql, { schema });

// Re-export alert engine so API routes import from one place
export { runAlertEngine, checkOfflineTags } from "../../db/alert-engine";
