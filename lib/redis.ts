import { Redis } from "@upstash/redis";

let cached: Redis | null | undefined;

/**
 * Returns a Redis client if env-vars are configured, else null.
 * Accepts both Upstash Marketplace naming (UPSTASH_REDIS_REST_*)
 * and legacy Vercel KV naming (KV_REST_API_*).
 */
export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;

  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.KV_REST_API_URL ??
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
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
