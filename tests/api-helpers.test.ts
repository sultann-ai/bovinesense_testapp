import { describe, it, expect } from "vitest";
import {
  clampInt,
  dateParam,
  enumParam,
  errorCode,
  errorMessage,
  ilikeAny,
  intParam,
  isUuid,
  quoteFilterValue,
} from "../src/lib/api-helpers";

describe("quoteFilterValue", () => {
  it("wraps in double quotes", () => {
    expect(quoteFilterValue("abc")).toBe('"abc"');
  });

  it("escapes quotes and backslashes so a value cannot break out of the filter", () => {
    expect(quoteFilterValue('a"b')).toBe('"a\\"b"');
    expect(quoteFilterValue("a\\b")).toBe('"a\\\\b"');
  });
});

describe("ilikeAny", () => {
  it("builds an OR list over every column", () => {
    expect(ilikeAny(["a", "b"], "x")).toBe('a.ilike."%x%",b.ilike."%x%"');
  });

  it("keeps commas, parentheses and dots inside the quoted value", () => {
    const f = ilikeAny(["a"], "x),b.eq.1,(c");
    expect(f).toBe('a.ilike."%x),b.eq.1,(c%"');
    // the whole term stays inside one quoted string
    expect(f.split('"')).toHaveLength(3);
  });
});

describe("intParam", () => {
  it("returns null when absent", () => {
    expect(intParam(null)).toBeNull();
    expect(intParam("")).toBeNull();
  });
  it("parses integers and flags malformed input as NaN", () => {
    expect(intParam("12")).toBe(12);
    expect(intParam("-3")).toBe(-3);
    expect(intParam("1.5")).toBeNaN();
    expect(intParam("1; drop")).toBeNaN();
  });
});

describe("clampInt", () => {
  it("falls back when absent or malformed", () => {
    expect(clampInt(null, 100, 1, 200)).toBe(100);
    expect(clampInt("abc", 100, 1, 200)).toBe(100);
  });
  it("clamps into range", () => {
    expect(clampInt("999", 100, 1, 200)).toBe(200);
    expect(clampInt("0", 100, 1, 200)).toBe(1);
    expect(clampInt("50", 100, 1, 200)).toBe(50);
  });
});

describe("enumParam", () => {
  const allowed = ["new", "resolved"] as const;
  it("accepts allowed values and absence", () => {
    expect(enumParam("new", allowed)).toEqual({ ok: true, value: "new" });
    expect(enumParam(null, allowed)).toEqual({ ok: true, value: null });
  });
  it("rejects anything else", () => {
    expect(enumParam("bogus", allowed)).toEqual({ ok: false });
  });
});

describe("dateParam", () => {
  it("returns null, a Date, or undefined for malformed", () => {
    expect(dateParam(null)).toBeNull();
    expect(dateParam("2026-10-09")).toBeInstanceOf(Date);
    expect(dateParam("not-a-date")).toBeUndefined();
  });
});

describe("isUuid", () => {
  it("accepts canonical uuids only", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
    expect(isUuid("123e4567e89b12d3a456426614174000")).toBe(false);
    expect(isUuid("1; drop table")).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("error helpers", () => {
  it("reads message and code from Error and plain objects", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage({ message: "pg failed", code: "P0002" })).toBe("pg failed");
    expect(errorMessage(42)).toBe("Internal error");
    expect(errorCode({ code: "22023" })).toBe("22023");
    expect(errorCode(new Error("x"))).toBeUndefined();
  });
});
