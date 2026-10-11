"use client";

import { Component, type ReactNode } from "react";

/**
 * Keeps a failing map from taking the whole page with it.
 *
 * Google's own code can throw while a map is being set up (typically when it rejects the API key:
 * the key is invalid, or this site's address is not in the key's HTTP-referrer list). Without this,
 * React unmounts the entire page and the user loses the KPIs, the alert feed and the live status
 * along with the map. With it, only the map area is replaced by `fallback`; the rest keeps working.
 */
interface Props {
  fallback: (error: Error) => ReactNode;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class MapErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("[map] the map failed and was replaced by a notice:", error);
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
