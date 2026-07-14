import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows attempts up to the configured maximum", () => {
    const key = `test:${Math.random()}`;
    const config = { windowMs: 1000, maxAttempts: 3 };

    expect(rateLimit(key, config).allowed).toBe(true);
    expect(rateLimit(key, config).allowed).toBe(true);
    expect(rateLimit(key, config).allowed).toBe(true);
  });

  it("blocks once the maximum is exceeded within the window", () => {
    const key = `test:${Math.random()}`;
    const config = { windowMs: 1000, maxAttempts: 2 };

    expect(rateLimit(key, config).allowed).toBe(true);
    expect(rateLimit(key, config).allowed).toBe(true);
    expect(rateLimit(key, config).allowed).toBe(false);
    expect(rateLimit(key, config).remaining).toBe(0);
  });

  it("resets once the window elapses", () => {
    const key = `test:${Math.random()}`;
    const config = { windowMs: 1000, maxAttempts: 1 };

    expect(rateLimit(key, config).allowed).toBe(true);
    expect(rateLimit(key, config).allowed).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(rateLimit(key, config).allowed).toBe(true);
  });

  it("tracks independent keys separately", () => {
    const config = { windowMs: 1000, maxAttempts: 1 };
    const keyA = `a:${Math.random()}`;
    const keyB = `b:${Math.random()}`;

    expect(rateLimit(keyA, config).allowed).toBe(true);
    expect(rateLimit(keyA, config).allowed).toBe(false);
    expect(rateLimit(keyB, config).allowed).toBe(true);
  });
});
