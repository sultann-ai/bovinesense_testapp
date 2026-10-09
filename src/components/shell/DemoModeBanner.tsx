"use client";

import { FlaskConical } from "lucide-react";

export function DemoModeBanner() {
  return (
    <div
      className="flex items-center justify-center gap-2 border-b px-4 py-2 text-xs font-medium"
      style={{
        backgroundColor: "color-mix(in srgb, var(--highlight) 12%, var(--bg-surface))",
        borderColor: "color-mix(in srgb, var(--highlight) 40%, transparent)",
        color: "var(--text-primary)",
      }}
    >
      <FlaskConical size={13} style={{ color: "var(--highlight)" }} />
      <span>
        Demo environment:{" "}
        <span className="font-semibold">1 live tag</span>, 240 simulated animals.
      </span>
    </div>
  );
}
