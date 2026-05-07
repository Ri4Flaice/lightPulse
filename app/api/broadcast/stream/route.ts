import {
  BROADCAST_CHANNEL,
  getBroadcastState,
  type BroadcastState,
} from "@/lib/broadcast";
import { createRedisSubscriber } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel hard cap on Hobby is ~60s; we close earlier to let EventSource reconnect cleanly.
export const maxDuration = 60;

const STREAM_TTL_MS = 50_000;
const KEEPALIVE_MS = 15_000;

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  const subscriber = createRedisSubscriber();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(ttlTimer);
        clearInterval(keepaliveTimer);
        try {
          subscriber?.unsubscribe(BROADCAST_CHANNEL).catch(() => {});
          subscriber?.quit().catch(() => {});
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (data: BroadcastState | { type: "ping" }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          close();
        }
      };

      const ttlTimer = setTimeout(close, STREAM_TTL_MS);
      const keepaliveTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          close();
        }
      }, KEEPALIVE_MS);

      // Send current state immediately
      try {
        const initial = await getBroadcastState();
        send(initial);
      } catch {
        /* ignore */
      }

      if (subscriber) {
        subscriber.on("message", (channel, message) => {
          if (channel !== BROADCAST_CHANNEL) return;
          try {
            const parsed = JSON.parse(message) as BroadcastState;
            send(parsed);
          } catch {
            /* ignore malformed message */
          }
        });
        try {
          await subscriber.subscribe(BROADCAST_CHANNEL);
        } catch (e) {
          console.error("[/api/broadcast/stream] subscribe failed:", e);
          close();
          return;
        }
      } else {
        // No Redis configured — close after sending initial default.
        setTimeout(close, 100);
      }

      // Abort handling
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      try {
        subscriber?.quit().catch(() => {});
      } catch {
        /* ignore */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
