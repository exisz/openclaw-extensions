#!/usr/bin/env node --experimental-strip-types
/**
 * Linked adaptive cron frequency adjuster.
 *
 * Sets a cron's frequency to a multiple of another cron's frequency.
 *
 * Usage: ocx cron link <follower_id> <source_id> <multiplier>
 *
 * Safety:
 * - Follower name must contain [ADAPTIVE] or [LINKED]
 * - Both schedule kinds must be "every"
 * - anchorMs is never changed
 * - Multiplier must be >= 1
 * - Result clamped to 1h–168h
 */
export {};
//# sourceMappingURL=cron-link.d.ts.map