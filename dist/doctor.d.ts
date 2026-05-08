#!/usr/bin/env node
/**
 * ocx doctor — Validate OpenClaw config beyond what `openclaw doctor` checks.
 *
 * Currently checks:
 *   - Agent-level `model` overrides are valid (known model ID or omitted)
 *   - Default model primary + fallbacks are all known model IDs
 *   - No bare "default" strings used as model values (legacy, breaks at runtime)
 *
 * Why: openclaw doctor does not validate per-agent model fields.
 * Unknown model strings are silently accepted and only fail at runtime
 * (openclaw/openclaw#39811).
 *
 * Usage:
 *   ocx doctor
 *   ocx doctor --fix     (removes invalid per-agent model overrides)
 */
export {};
//# sourceMappingURL=doctor.d.ts.map