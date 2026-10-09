/**
 * GET /api/events
 *
 * Server-Sent Events stream of fixes and alert changes.
 * Filtered by optional query params:
 *   ?region_id=<n>  — only events for animals in this region
 *   ?branch_id=<n>  — only events for animals in this branch
 *
 * Keep-alive comment ": ping" sent every 30 s to prevent proxy timeouts.
 */
import { NextRequest } from "next/server";
import { eventBus, type BovineEvent } from "@/lib/event-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url      = req.nextUrl;
  const regionId = url.searchParams.get("region_id") ? Number(url.searchParams.get("region_id")) : null;
  const branchId = url.searchParams.get("branch_id") ? Number(url.searchParams.get("branch_id")) : null;

  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (text: string) => {
        try { controller.enqueue(enc.encode(text)); } catch { /* closed */ }
      };

      // Send an initial comment so the connection is established immediately
      enqueue(": connected\n\n");

      const handler = (event: BovineEvent) => {
        if (regionId !== null && event.regionId !== regionId) return;
        if (branchId !== null && event.branchId !== branchId) return;
        enqueue(`data: ${JSON.stringify(event)}\n\n`);
      };

      eventBus.on("bovine", handler);

      // Keep-alive ping every 30 s
      const ping = setInterval(() => enqueue(": ping\n\n"), 30_000);

      req.signal.addEventListener("abort", () => {
        eventBus.off("bovine", handler);
        clearInterval(ping);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
