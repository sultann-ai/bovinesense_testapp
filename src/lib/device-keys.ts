/**
 * Device API keys: the credential a tag, gateway or simulator sends in the `x-api-key` header.
 *
 * A key is 32 random bytes, shown to the person who creates it exactly once. Only its SHA-256 hash
 * is stored (device_api_keys.key_hash), so a database leak does not leak working keys. Because the
 * key is high-entropy random data, a plain unsalted hash is appropriate (unlike a password), and it
 * lets ingestion find the key with one indexed lookup.
 *
 * Pure Node (no Next, no Supabase): usable from route handlers and from scripts.
 */
import { createHash, randomBytes } from "node:crypto";

/** Visible prefix, so a key is recognisable in logs and lists ("bsk_" + the first 4 random chars). */
const KEY_PREFIX = "bsk_";
/** Characters kept in device_api_keys.key_prefix: enough to tell keys apart, not enough to guess. */
const SHOWN_PREFIX_LENGTH = 8;
/** 32 random bytes as base64url. */
const RANDOM_LENGTH = 43;

const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}[A-Za-z0-9_-]{${RANDOM_LENGTH}}$`);

export interface NewDeviceKey {
  /** The plain key. Show it once; never store or log it. */
  key: string;
  /** SHA-256 of the key, hex: what is stored. */
  hash: string;
  /** First characters of the key, safe to display in a list. */
  prefix: string;
}

export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateDeviceKey(): NewDeviceKey {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, hash: hashDeviceKey(key), prefix: key.slice(0, SHOWN_PREFIX_LENGTH) };
}

/**
 * Cheap shape check, done before touching the database so garbage never costs a query.
 * Passing it does not make a key valid; only a matching, un-revoked hash does.
 */
export function looksLikeDeviceKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

export { DEVICE_KEY_LABEL_MAX } from "./device-keys-shared";
