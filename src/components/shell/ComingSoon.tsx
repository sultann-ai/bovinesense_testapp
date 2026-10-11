import { Construction } from "lucide-react";
import { EmptyState } from "@/components/ui/states";

interface ComingSoonProps {
  title: string;
  description?: string;
  /** The one thing to do meanwhile. Defaults to going back to the Overview. */
  action?: { label: string; href: string };
}

/** A screen on the roadmap: a clean empty state with one action (DESIGN.md §2). */
export function ComingSoon({ title, description, action = { label: "Back to the Overview", href: "/" } }: ComingSoonProps) {
  return (
    <div className="mx-auto flex min-h-[400px] max-w-xl flex-col justify-center">
      <h1 className="text-center text-2xl font-semibold leading-8 text-text-primary">{title}</h1>
      <EmptyState
        icon={<Construction size={20} strokeWidth={1.5} />}
        title={description ?? "This screen is on the roadmap and will be available soon."}
        action={action}
      />
    </div>
  );
}
