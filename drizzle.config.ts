import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema:  "./db/schema.ts",
  out:     "./drizzle",
  dbCredentials: {
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
  verbose: true,
  strict:  true,
});
