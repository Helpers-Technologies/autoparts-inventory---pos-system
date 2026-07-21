"use strict";
/**
 * Pure rate-limiting state machine.
 * No Electron, DB, crypto, or I/O deps — safe to require from Vitest test harnesses.
 *
 * Both the login throttle (5 fails / 60 s) and the support-code throttle (5 fails / 10 min)
 * use the same underlying Map-based state machine parametrised by maxAttempts and lockoutMs.
 */

/**
 * Checks whether `key` is currently rate-limited.
 * Clears an expired lock as a side-effect.
 *
 * @param {Map} attempts - mutable attempt store
 * @param {string} key
 * @param {number} now - milliseconds since epoch
 * @returns {{ ok: false, error: 'rate_limited', remainSeconds: number, attemptsRemaining: 0 } | null}
 */
function checkRateLimit(attempts, key, now) {
  const entry = attempts.get(key);
  if (!entry) return null;
  if (entry.lockedUntil > now) {
    return {
      ok: false,
      error: "rate_limited",
      remainSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
      attemptsRemaining: 0,
    };
  }
  if (entry.lockedUntil > 0 && entry.lockedUntil <= now) {
    attempts.delete(key);
  }
  return null;
}

/**
 * Records a failed attempt for `key`.
 * Locks the key when maxAttempts is reached and returns a rate_limited result.
 * Otherwise returns an invalid_credentials result with remaining attempts.
 *
 * @param {Map} attempts
 * @param {string} key
 * @param {number} now
 * @param {number} maxAttempts
 * @param {number} lockoutMs
 * @returns {{ ok: false, error: string, remainSeconds?: number, attemptsRemaining: number }}
 */
function recordFailedAttempt(attempts, key, now, maxAttempts, lockoutMs) {
  const current = attempts.get(key) || { count: 0, lockedUntil: 0 };

  // Re-check for concurrent lock (another request may have locked while password was verified)
  if (current.lockedUntil > now) {
    return {
      ok: false,
      error: "rate_limited",
      remainSeconds: Math.ceil((current.lockedUntil - now) / 1000),
      attemptsRemaining: 0,
    };
  }
  if (current.lockedUntil > 0 && current.lockedUntil <= now) {
    current.count = 0;
    current.lockedUntil = 0;
  }

  current.count += 1;
  if (current.count >= maxAttempts) {
    current.lockedUntil = now + lockoutMs;
    current.count = 0;
    attempts.set(key, current);
    return {
      ok: false,
      error: "rate_limited",
      remainSeconds: Math.ceil(lockoutMs / 1000),
      attemptsRemaining: 0,
    };
  }

  attempts.set(key, current);
  return {
    ok: false,
    error: "invalid_credentials",
    attemptsRemaining: Math.max(0, maxAttempts - current.count),
  };
}

/**
 * Records a failed support-code attempt.
 * Unlike login, the lock is only returned on the NEXT check after reaching maxAttempts.
 *
 * @param {Map} attempts
 * @param {string} key
 * @param {number} now
 * @param {number} maxAttempts
 * @param {number} lockoutMs
 * @returns {{ ok: false, error: 'rate_limited', remainSeconds: number } | null} null if not yet locked
 */
function recordFailedSupportAttempt(attempts, key, now, maxAttempts, lockoutMs) {
  const current = attempts.get(key) || { count: 0, lockedUntil: 0 };
  current.count += 1;
  if (current.count >= maxAttempts) {
    current.count = 0;
    current.lockedUntil = now + lockoutMs;
  }
  attempts.set(key, current);
  return checkRateLimit(attempts, key, now);
}

/**
 * Clears all state for `key` (call on successful auth).
 * @param {Map} attempts
 * @param {string} key
 */
function clearAttempts(attempts, key) {
  attempts.delete(key);
}

module.exports = {
  checkRateLimit,
  recordFailedAttempt,
  recordFailedSupportAttempt,
  clearAttempts,
};
