import { EventEmitter } from "node:events";

declare global {
  // eslint-disable-next-line no-var
  var _bovineEventBus: EventEmitter | undefined;
}

export const eventBus: EventEmitter =
  global._bovineEventBus ??
  (global._bovineEventBus = new EventEmitter().setMaxListeners(500));

export interface FixEvent {
  kind: "fix";
  animalId: number;
  tagId: number;
  lat: number;
  lon: number;
  fixedAt: string;
  branchId: number;
  regionId: number;
}

export interface AlertChangeEvent {
  kind: "alert";
  alertId: number;
  alertType: string;
  severity: string;
  status: string;
  animalId: number;
  branchId: number;
  regionId: number;
}

export type BovineEvent = FixEvent | AlertChangeEvent;

export function emitFix(e: Omit<FixEvent, "kind">) {
  eventBus.emit("bovine", { kind: "fix", ...e } satisfies FixEvent);
}

export function emitAlert(e: Omit<AlertChangeEvent, "kind">) {
  eventBus.emit("bovine", { kind: "alert", ...e } satisfies AlertChangeEvent);
}
