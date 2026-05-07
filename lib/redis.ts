import { Redis } from "@upstash/redis";

let cached: Redis | null | undefined;

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
