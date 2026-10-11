/**
 * DOM for the things drawn on the map: animal pins, clusters, district labels and trail dots.
 *
 * Google's AdvancedMarkerElement takes an HTMLElement as its content, so these are built as plain
 * DOM (not React): hundreds of pins are cheap this way, and the same builders serve the main map,
 * the cluster renderer and the drawer's mini map. Look and colour live in globals.css (.bs-pin,
 * .bs-cluster, ...) and use tokens only; this file only sets structure and state attributes.
 *
 * Everything is built with createElement / createElementNS and textContent: no HTML strings, so
 * nothing from data can ever be interpreted as markup.
 */
import type { ClusterVisual } from "@/lib/maps/cluster";
import type { PinVisual } from "@/lib/maps/status";

const SVG_NS = "http://www.w3.org/2000/svg";

type Shape = readonly [tag: "path" | "circle", attrs: Readonly<Record<string, string>>];

function svg(strokeWidth: string, shapes: readonly Shape[]): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, "svg");
  root.setAttribute("viewBox", "0 0 24 24");
  root.setAttribute("fill", "none");
  root.setAttribute("stroke", "currentColor");
  root.setAttribute("stroke-width", strokeWidth);
  root.setAttribute("stroke-linecap", "round");
  root.setAttribute("stroke-linejoin", "round");
  root.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    root.append(node);
  }
  return root;
}

/** A simple cattle head (DESIGN.md: "one custom glyph"), outline style like the Lucide icons. */
const cattleGlyph = () =>
  svg("1.7", [
    ["path", { d: "M3 4.5c0 2.8 1.8 4 4 4" }],
    ["path", { d: "M21 4.5c0 2.8-1.8 4-4 4" }],
    ["path", { d: "M7.5 8.5h9l1.2 6.2c.3 3.2-2 5.8-5.7 5.8s-6-2.6-5.7-5.8z" }],
    ["path", { d: "M9.2 17.6h5.6" }],
    ["circle", { cx: "9.6", cy: "13", r: ".7", fill: "currentColor", stroke: "none" }],
    ["circle", { cx: "14.4", cy: "13", r: ".7", fill: "currentColor", stroke: "none" }],
  ]);

const clockGlyph = () =>
  svg("3", [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["path", { d: "M12 7v5l3 2" }],
  ]);

const shieldAlertGlyph = () =>
  svg("3", [
    ["path", { d: "M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" }],
    ["path", { d: "M12 8v4" }],
    ["path", { d: "M12 16h.01" }],
  ]);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: Node[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

/** An empty pin; give it its state with updatePinElement. */
export function createPinElement(): HTMLElement {
  const pin = el(
    "div",
    "bs-pin",
    el("span", "bs-pin__pulse"),
    el("span", "bs-pin__disc", cattleGlyph()),
    el("span", "bs-pin__ring"),
    el("span", "bs-pin__clock", clockGlyph()),
  );
  pin.setAttribute("role", "img");
  return pin;
}

/** Set a pin's state. The classes in globals.css do the rest (colour, ring, pulse, grey). */
export function updatePinElement(pin: HTMLElement, v: PinVisual): void {
  pin.dataset.status = v.status;
  pin.dataset.selected = String(v.selected);
  pin.dataset.pulse = String(v.pulse);
  pin.dataset.stale = String(v.stale);
  pin.setAttribute("aria-label", v.label);
}

/** A cluster bubble: the count, and with any breach a crimson ring and a badge with the breach count. */
export function createClusterElement(v: ClusterVisual): HTMLElement {
  const count = el("span", "bs-cluster__count");
  count.textContent = v.label;

  const breaches = el("span", "bs-cluster__breaches");
  breaches.textContent = v.breachLabel;
  const badge = el("span", "bs-cluster__badge", shieldAlertGlyph(), breaches);

  const bubble = el("div", "bs-cluster", count, badge);
  bubble.setAttribute("role", "img");
  bubble.setAttribute("aria-label", v.ariaLabel);
  bubble.dataset.breach = String(v.hasBreach);
  bubble.style.width = bubble.style.height = `${v.diameter}px`;
  return bubble;
}

export function createDistrictLabel(text: string): HTMLElement {
  const label = el("div", "bs-district-label");
  label.textContent = text;
  return label;
}

/** A dot for one fix on the trail. `passed` dims the dots the playhead has not reached yet. */
export function createTrailDot(passed: boolean, title: string): HTMLElement {
  const dot = el("div", "bs-trail-dot");
  dot.dataset.passed = String(passed);
  dot.title = title;
  return dot;
}

export function createTrailHead(): HTMLElement {
  return el("div", "bs-trail-head");
}

/** A CSS token's value (for the few APIs that need a literal colour, such as polylines). */
export function readToken(name: string, fallback = "black"): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
