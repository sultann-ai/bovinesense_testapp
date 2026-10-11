import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateDeviceKey, hashDeviceKey, looksLikeDeviceKey } from "../src/lib/device-keys";

describe("device keys", () => {
  it("hashes with SHA-256 (known vector)", () => {
    expect(hashDeviceKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("generates a key whose stored hash is the SHA-256 of the plain key", () => {
    const { key, hash, prefix } = generateDeviceKey();
    expect(hash).toBe(createHash("sha256").update(key).digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // the shape device_api_keys.key_hash enforces
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix).toHaveLength(8);
  });

  it("never stores or exposes the plain key in the hash or prefix", () => {
    const { key, hash, prefix } = generateDeviceKey();
    expect(hash).not.toContain(key.slice(4));
    expect(prefix.length).toBeLessThan(key.length / 4);
  });

  it("generates distinct keys with 256 bits of randomness", () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateDeviceKey().key));
    expect(keys.size).toBe(200);
    const { key } = generateDeviceKey();
    expect(key).toHaveLength(4 + 43);
  });

  it("recognises well-formed keys and rejects everything else", () => {
    expect(looksLikeDeviceKey(generateDeviceKey().key)).toBe(true);
    for (const bad of [
      "", "bsk_", "bsk_short", "x".repeat(47), "BSK_" + "a".repeat(43), "bsk_" + "a".repeat(44),
      "bsk_" + "a".repeat(42) + "!", "bsk_" + "a".repeat(43) + "\n", null, undefined, 42, {},
    ]) {
      expect(looksLikeDeviceKey(bad), String(bad)).toBe(false);
    }
  });
});
