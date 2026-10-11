// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createClusterElement, createDistrictLabel, createPinElement, createTrailDot, createTrailHead,
  readToken, updatePinElement,
} from "../src/components/map/dom";
import { pinVisual } from "../src/lib/maps/status";
import { clusterVisual, summarizeCluster } from "../src/lib/maps/cluster";

const visual = (over: Partial<Parameters<typeof pinVisual>[0]> = {}) =>
  pinVisual({ status: "inside", hasUnackBreach: false, selected: false, ...over });

describe("pin element", () => {
  it("has the DESIGN.md parts: a disc with the cattle glyph, a selection ring, a pulse and a clock", () => {
    const pin = createPinElement();
    expect(pin.className).toBe("bs-pin");
    expect(pin.querySelector(".bs-pin__disc svg")).not.toBeNull();
    for (const part of ["bs-pin__ring", "bs-pin__pulse", "bs-pin__clock"]) expect(pin.querySelector("." + part), part).not.toBeNull();
    expect(pin.getAttribute("role")).toBe("img");
  });

  it("is told its state through data attributes, which the stylesheet turns into colour and rings", () => {
    const pin = createPinElement();
    updatePinElement(pin, visual({ status: "breach", hasUnackBreach: true, selected: true, tagSerial: "SIM-9" }));
    expect(pin.dataset).toMatchObject({ status: "breach", selected: "true", pulse: "true", stale: "false" });
    expect(pin.getAttribute("aria-label")).toBe("SIM-9: Breach (not acknowledged)");

    updatePinElement(pin, visual({ status: "stale" }));
    expect(pin.dataset).toMatchObject({ status: "stale", selected: "false", pulse: "false", stale: "true" });

    updatePinElement(pin, visual({ status: "inside" }));
    expect(pin.dataset).toMatchObject({ status: "inside", pulse: "false", stale: "false" });
  });

  it("updating reuses the same element (no rebuild per fix)", () => {
    const pin = createPinElement();
    const disc = pin.querySelector(".bs-pin__disc");
    updatePinElement(pin, visual({ status: "near" }));
    updatePinElement(pin, visual({ status: "fast" }));
    expect(pin.querySelector(".bs-pin__disc")).toBe(disc);
  });

  it("never carries a hex colour: colour is the stylesheet's job", () => {
    const pin = createPinElement();
    updatePinElement(pin, visual({ status: "breach", hasUnackBreach: true }));
    expect(pin.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(pin.outerHTML).not.toMatch(/style=/);
  });
});

describe("cluster element", () => {
  const cluster = (statuses: string[]) => createClusterElement(clusterVisual(summarizeCluster(statuses)));

  it("shows the count", () => {
    const c = cluster(["inside", "inside", "near"]);
    expect(c.querySelector(".bs-cluster__count")?.textContent).toBe("3");
    expect(c.getAttribute("aria-label")).toBe("3 animals");
    expect(c.dataset.breach).toBe("false");
  });

  it("a cluster containing a breach is marked for the crimson ring, with the breach count in the badge", () => {
    const c = cluster(["inside", "breach", "breach", "near"]);
    expect(c.dataset.breach).toBe("true");
    expect(c.querySelector(".bs-cluster__breaches")?.textContent).toBe("2");
    expect(c.querySelector(".bs-cluster__badge svg")).not.toBeNull(); // icon + number, never colour alone
    expect(c.getAttribute("aria-label")).toBe("4 animals, 2 in breach");
  });

  it("a cluster without a breach has an empty badge (hidden by the stylesheet)", () => {
    expect(cluster(["inside"]).querySelector(".bs-cluster__breaches")?.textContent).toBe("");
  });

  it("is sized by its count", () => {
    const px = (n: number) => parseInt(cluster(Array(n).fill("inside")).style.width, 10);
    expect(px(3)).toBeLessThan(px(30));
    expect(px(30)).toBeLessThan(px(300));
  });
});

describe("labels and trail", () => {
  it("puts text in as text, never as markup", () => {
    const hostile = '<img src=x onerror="alert(1)">Lahore';
    const label = createDistrictLabel(hostile);
    expect(label.textContent).toBe(hostile);
    expect(label.querySelector("img")).toBeNull();
    const dot = createTrailDot(true, hostile);
    expect(dot.title).toBe(hostile);
    expect(dot.querySelector("img")).toBeNull();
  });

  it("trail dots say whether the playhead has passed them", () => {
    expect(createTrailDot(true, "t").dataset.passed).toBe("true");
    expect(createTrailDot(false, "t").dataset.passed).toBe("false");
    expect(createTrailHead().className).toBe("bs-trail-head");
  });
});

describe("readToken", () => {
  it("reads a CSS custom property, trimmed, and falls back when unset", () => {
    document.documentElement.style.setProperty("--map-boundary", "  #B9AE9C ");
    expect(readToken("--map-boundary", "black")).toBe("#B9AE9C");
    expect(readToken("--not-defined", "gray")).toBe("gray");
    expect(readToken("--not-defined")).toBe("black");
  });
});
