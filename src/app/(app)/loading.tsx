import { Skeleton } from "@/components/ui/states";

/** Shown while a screen's server part loads: a title and a few rows, in the shape of what is coming. */
export default function AppLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-[var(--radius-md)] border border-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-none" />
        ))}
      </div>
    </div>
  );
}
