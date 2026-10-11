import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/states";

/** Shown instead of a page the user's role may not open. */
export function AccessDenied({ title = "You don't have access to this page." }: { title?: string }) {
  return (
    <div className="mx-auto flex min-h-[400px] max-w-xl flex-col justify-center">
      <EmptyState
        icon={<Lock size={20} strokeWidth={1.5} />}
        title={`${title} Ask an organization administrator if you need it.`}
        action={{ label: "Back to the Overview", href: "/" }}
      />
    </div>
  );
}
