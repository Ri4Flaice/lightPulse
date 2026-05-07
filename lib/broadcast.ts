import { getRedis, getRedisPublisher } from "./redis";

const STATE_KEY = "broadcast:state";
export const BROADCAST_CHANNEL = "broadcast:events";

export type BroadcastState = {
  playing: boolean;
  version: number;
  ts: number;
};

const DEFAULT_STATE: BroadcastState = { playing: false, version: 0, ts: 0 };

function isState(x: unknown): x is BroadcastState {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.playing === "boolean" &&
    typeof o.version === "number" &&
    typeof o.ts === "number"
  );
}

export async function getBroadcastState(): Promise<BroadcastState> {
  const r = getRedis();
  if (!r) return DEFAULT_STATE;
  try {
    const raw = await r.get<unknown>(STATE_KEY);
    if (raw == null) return DEFAULT_STATE;
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isState(obj) ? obj : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

export async function toggleBroadcast(): Promise<BroadcastState> {
  const r = getRedis();
  if (!r) throw new Error("Хранилище не настроено");
  const current = await getBroadcastState();
  const next: BroadcastState = {
    playing: !current.playing,
    version: current.version + 1,
    ts: Date.now(),
  };
  await r.set(STATE_KEY, JSON.stringify(next));

  const pub = getRedisPublisher();
  if (pub) {
    try {
      await pub.publish(BROADCAST_CHANNEL, JSON.stringify(next));
    } catch (e) {
      console.error("[broadcast] publish failed:", e);
    }
  }
  return next;
}
