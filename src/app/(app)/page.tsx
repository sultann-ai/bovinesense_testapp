"use client";
import dynamic from "next/dynamic";

// MapLibre GL JS requires browser APIs — never run on the server.
const OverviewClient = dynamic(
  () => import("@/components/overview/OverviewClient"),
  { ssr: false },
);

export default function OverviewPage() {
  return <OverviewClient />;
}
