import { FlaskConical } from "lucide-react";

/**
 * A slim strip with a gold left border under the top bar (DESIGN.md §8). It protects credibility when someone
 * asks how many tags are real, so it is shown whenever the organization's demo_mode setting is on.
 * The message is built from the organization's own tag counts (see demoBannerMessage), or is the
 * custom text in settings.demo_banner; nothing about it is hardcoded.
 */
export function DemoModeBanner({ message }: { message: string }) {
  return (
    <div
      role="note"
      data-testid="demo-banner"
      className="flex items-center gap-2 border-b border-l-4 border-border px-4 py-1 text-xs font-medium leading-4 text-text-primary"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderLeftColor: "var(--highlight)",
      }}
    >
      <FlaskConical size={14} strokeWidth={1.5} aria-hidden className="text-text-secondary" />
      <span>{message}</span>
    </div>
  );
}
