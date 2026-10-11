"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_OFFLINE_THRESHOLD_HOURS } from "@/lib/tenant-settings";
import { DEFAULT_TIMEZONE } from "@/lib/format";

/**
 * Who the signed-in user is working for, from the organization row: its name and logo, the timezone
 * clock times are shown in, and how long without a fix counts as offline. Nothing about a tenant is
 * a constant in the components; they read it from here.
 */
export interface TenantValue {
  name: string;
  logoUrl: string | null;
  timezone: string;
  offlineThresholdHours: number;
}

const TenantContext = createContext<TenantValue>({
  name: "",
  logoUrl: null,
  timezone: DEFAULT_TIMEZONE,
  offlineThresholdHours: DEFAULT_OFFLINE_THRESHOLD_HOURS,
});

export function TenantProvider({ value, children }: { value: TenantValue; children: React.ReactNode }) {
  const { name, logoUrl, timezone, offlineThresholdHours } = value;
  const memo = useMemo(() => ({ name, logoUrl, timezone, offlineThresholdHours }), [name, logoUrl, timezone, offlineThresholdHours]);
  return <TenantContext.Provider value={memo}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantValue {
  return useContext(TenantContext);
}
