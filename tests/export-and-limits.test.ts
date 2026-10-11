import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../src/lib/csv";
import { hit, isBlocked, resetRateLimits } from "../src/lib/rate-limit";

describe("csvCell", () => {
  it("leaves plain values alone and writes null as empty", () => {
    expect(csvCell("Lahore Main")).toBe("Lahore Main");
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
  });

  it("defuses spreadsheet formulas typed by users", () => {
    for (const v of ["=1+1", "+cmd", "-2", "@SUM(A1)"]) expect(csvCell(v)).toBe(`'${v}`);
  });
});

describe("toCsv", () => {
  it("writes a BOM, a header and CRLF rows", () => {
    expect(toCsv(["A", "B"], [[1, "x,y"]])).toBe('﻿A,B\r\n1,"x,y"\r\n');
  });
});

describe("rate limiter", () => {
  it("allows up to the limit in a window, then refuses until it ends", () => {
    resetRateLimits();
    expect([1, 2, 3].map(() => hit("k", 3, 1000, 0).allowed)).toEqual([true, true, true]);
    const over = hit("k", 3, 1000, 100);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBe(1);
    expect(hit("k", 3, 1000, 1000).allowed).toBe(true); // a new window
  });

  it("isBlocked looks without counting", () => {
    resetRateLimits();
    hit("b", 1, 1000, 0);
    expect(isBlocked("b", 1, 1000, 10).allowed).toBe(false);
    expect(isBlocked("other", 1, 1000, 10).allowed).toBe(true);
  });
});
