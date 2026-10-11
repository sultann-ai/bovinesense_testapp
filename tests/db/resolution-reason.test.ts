/**
 * Migration 20261010000001: the resolution reason is lender-neutral ("moved with consent"), and the
 * rename kept every other reason intact.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./backend";

describe("resolution_reason enum", () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db.close(); });

  it("has the four reasons from the alert lifecycle, with no bank-specific wording", async () => {
    const r = await db.query(
      "select e.enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'resolution_reason' order by e.enumsortorder",
    );
    expect(r.rows.map((x) => x.v)).toEqual(["returned_home", "false_alarm", "moved_with_consent", "escalated_to_recovery"]);
  });
});
