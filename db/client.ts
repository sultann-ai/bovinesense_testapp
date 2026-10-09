import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { createDatabaseClient } from "./connection";

// Single connection for migrations/scripts; pool for the app
export const sql = createDatabaseClient({ max: 10 });
export const db  = drizzle(sql, { schema });
