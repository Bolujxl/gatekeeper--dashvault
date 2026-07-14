const attempts = new Map<string, { count: number; resetAt: number }>();

interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
}

/**
 * In-memory fixed-window limiter. Fine for a single dev/small-instance server;
 * swap for Redis (e.g. @upstash/ratelimit) before running multiple instances,
 * since this Map does not survive a restart or get shared across processes.
 */
export function rateLimit(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxAttempts - 1 };
  }

  if (entry.count >= config.maxAttempts) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: config.maxAttempts - entry.count };
}
