"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/states";

/**
 * What every screen in the app shell shows when it fails to render: what happened, and a retry that
 * re-fetches and re-renders the screen. The shell (rail and top bar) stays on screen.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl">
      <ErrorState what="This screen could not be loaded." onRetry={retry} />
    </div>
  );
}
