#!/usr/bin/env node
/**
 * ocx model-debug — Diagnose model call failures for an agent/channel session.
 *
 * Investigation method:
 *   1. Scan trajectory.jsonl files for the agent (optionally filtered by channel id)
 *   2. For each run: extract model.completed events → check stopReason/errorMessage
 *   3. Also check discord model-picker-preferences.json for what was selected
 *   4. Surface errors, fallbacks, and 0-token calls clearly
 *
 * Usage:
 *   ocx model-debug --agent <id>
 *   ocx model-debug --agent <id> --channel <discord_channel_id>
 *   ocx model-debug --agent <id> --last <n>
 *   ocx model-debug --session <path-or-session-id>
 */
export {};
//# sourceMappingURL=model-debug.d.ts.map