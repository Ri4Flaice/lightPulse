import {
  BROADCAST_CHANNEL,
  CONFIG_CHANNEL,
  getBroadcastState,
  type BroadcastState,
} from "@/lib/broadcast";
import { readConfig, type Config } from "@/lib/config";
import { createRedisSubscriber } from "@/lib/redis";

type StreamEvent =
  | { type: "broadcast"; payload: BroadcastState }
  | { type: "config"; payload: Config }
  | { type: "ping" };

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
          subscriber?.unsubscribe(BROADCAST_CHANNEL, CONFIG_CHANNEL).catch(() => {});
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

      const send = (data: StreamEvent) => {
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

      // Send current state + config immediately
      try {
        const [initialState, initialConfig] = await Promise.all([
          getBroadcastState(),
          readConfig(),
        ]);
        send({ type: "broadcast", payload: initialState });
        send({ type: "config", payload: initialConfig });
      } catch {
        /* ignore */
      }

      if (subscriber) {
        subscriber.on("message", (channel, message) => {
          try {
            if (channel === BROADCAST_CHANNEL) {
              send({ type: "broadcast", payload: JSON.parse(message) as BroadcastState });
            } else if (channel === CONFIG_CHANNEL) {
              send({ type: "config", payload: JSON.parse(message) as Config });
            }
          } catch {
            /* ignore malformed message */
          }
        });
        try {
          await subscriber.subscribe(BROADCAST_CHANNEL, CONFIG_CHANNEL);
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
