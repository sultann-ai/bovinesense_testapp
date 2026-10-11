/**
 * How an animal looks on the map. Pure and client-safe; the colours live in the CSS tokens
 * (--status-*), never here: this module only decides WHICH state a pin is in.
 *
 * DESIGN.md §6 "Markers": a 28 px circle with a white outline, filled with the status colour and a
 * cattle glyph; selected gets a gold ring and 1.15x scale; an unacknowledged breach pulses; stale is
 * grey at 60% with a small clock badge so an old position never looks current.
 */

export const ANIMAL_STATUSES = ["inside", "near", "breach", "fast", "stale"] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

export const STATUS_LABELS: Record<AnimalStatus, string> = {
  inside: "Inside boundary",
  near: "Near boundary",
  breach: "Breach",
  fast: "Fast movement",
  stale: "Offline",
};

/** Anything unknown is treated as stale: when in doubt, never draw a position as healthy. */
export function normalizeStatus(value: unknown): AnimalStatus {
  return (ANIMAL_STATUSES as readonly string[]).includes(value as string) ? (value as AnimalStatus) : "stale";
}

export interface PinInput {
  status: unknown;
  hasUnackBreach: boolean;
  selected: boolean;
  tagSerial?: string | null;
  animalName?: string | null;
}

export interface PinVisual {
  status: AnimalStatus;
  selected: boolean;
  /** The slow pulse ring: an unacknowledged breach, and nothing else. */
  pulse: boolean;
  /** Grey at 60% with a clock badge. */
  stale: boolean;
  zIndex: number;
  /** What a screen reader and the hover tooltip say: status in words, never colour alone. */
  label: string;
}

const Z_BY_STATUS: Record<AnimalStatus, number> = { breach: 400, fast: 300, near: 300, inside: 200, stale: 100 };
const Z_SELECTED = 1000;

export function pinVisual(input: PinInput): PinVisual {
  const status = normalizeStatus(input.status);
  const who = [input.tagSerial, input.animalName].filter((x): x is string => Boolean(x)).join(" · ");
  const words = STATUS_LABELS[status] + (status === "breach" && input.hasUnackBreach ? " (not acknowledged)" : "");
  return {
    status,
    selected: input.selected,
    pulse: status === "breach" && input.hasUnackBreach,
    stale: status === "stale",
    zIndex: input.selected ? Z_SELECTED : Z_BY_STATUS[status],
    label: who ? `${who}: ${words}` : words,
  };
}
