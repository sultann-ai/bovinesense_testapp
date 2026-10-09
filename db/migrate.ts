/**
 * Run with: npx tsx db/migrate.ts
 *
 * Applies all pending Drizzle migrations in /drizzle, then enables PostGIS
 * extension if it is not already present.
 */
import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { createDatabaseClient } from "./connection";

async function main() {
  // Use a single connection for migrations (no pool)
  const migrationClient = createDatabaseClient({ direct: true, max: 1 });
  const db = drizzle(migrationClient);

  // Ensure PostGIS extension is installed
  await migrationClient`CREATE EXTENSION IF NOT EXISTS postgis`;
  await migrationClient`CREATE EXTENSION IF NOT EXISTS postgis_topology`;
  console.log("✓ PostGIS extensions enabled");

  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ Migrations applied");

  await migrationClient.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
