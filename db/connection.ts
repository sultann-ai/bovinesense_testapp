import postgres from "postgres";

/**
 * Supabase supports both pooled and direct PostgreSQL connections.
 * Use the direct URL for migrations and seed/import scripts; use the
 * regular URL for the application runtime.
 */
export function getDatabaseUrl(options: { direct?: boolean } = {}) {
  const url = options.direct
    ? process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
    : process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      options.direct
        ? "DIRECT_DATABASE_URL or DATABASE_URL is not set"
        : "DATABASE_URL is not set",
    );
  }

  return url;
}

export function createDatabaseClient(
  options: { direct?: boolean; max?: number } = {},
) {
  return postgres(getDatabaseUrl(options), {
    max: options.max ?? 5,
  });
}
