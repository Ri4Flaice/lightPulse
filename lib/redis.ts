import { Redis } from "@upstash/redis";
import IORedis, { Redis as IORedisClient } from "ioredis";

let cached: Redis | null | undefined;
let cachedTcpPub: IORedisClient | null | undefined;

/**
 * Returns a Redis client if env-vars are configured, else null.
 * Accepts both Upstash Marketplace naming (UPSTASH_REDIS_REST_*)
 * and legacy Vercel KV naming (KV_REST_API_*).
 */
export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;

  const env = process.env;
  const url =
    env.UPSTASH_REDIS_REST_URL ??
    env.KV_REST_API_URL ??
    env.upstash_KV_REST_API_URL ??
    env.upstash_REDIS_REST_URL ??
    "";
  const token =
    env.UPSTASH_REDIS_REST_TOKEN ??
    env.KV_REST_API_TOKEN ??
    env.upstash_KV_REST_API_TOKEN ??
    env.upstash_REDIS_REST_TOKEN ??
    "";

  if (!url || !token) {
    cached = null;
    return null;
  }
  cached = new Redis({ url, token });
  return cached;
}

export function isRedisConfigured(): boolean {
  return getRedis() !== null;
}

function getTcpUrl(): string | null {
  const env = process.env;
  return (
    env.REDIS_URL ??
    env.upstash_REDIS_URL ??
    env.UPSTASH_REDIS_URL ??
    null
  );
}

/** Long-lived publisher client (TCP) reused across requests when possible. */
export function getRedisPublisher(): IORedisClient | null {
  if (cachedTcpPub !== undefined) return cachedTcpPub;
  const url = getTcpUrl();
  if (!url) {
    cachedTcpPub = null;
    return null;
  }
  cachedTcpPub = new IORedis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    enableReadyCheck: false,
  });
  cachedTcpPub.on("error", (err) => {
    console.error("[redis pub] error:", err.message);
  });
  return cachedTcpPub;
}

/** Per-request subscriber client (TCP). Caller is responsible for quit(). */
export function createRedisSubscriber(): IORedisClient | null {
  const url = getTcpUrl();
  if (!url) return null;
  return new IORedis(url, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
    enableReadyCheck: false,
  });
}
