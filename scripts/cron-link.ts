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

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const JOBS_PATH = join(homedir(), ".openclaw/cron/jobs.json");

const MIN_MS = 3600000;    // 1h
const MAX_MS = 604800000;  // 168h

const DURATION_MAP: Array<{ ms: number; label: string }> = [
  { ms: 3600000, label: "1h" },
  { ms: 7200000, label: "2h" },
  { ms: 14400000, label: "4h" },
  { ms: 21600000, label: "6h" },
  { ms: 28800000, label: "8h" },
  { ms: 43200000, label: "12h" },
  { ms: 86400000, label: "24h" },
  { ms: 172800000, label: "48h" },
  { ms: 259200000, label: "72h" },
  { ms: 604800000, label: "168h" },
];

function msToDuration(ms: number): string {
  const exact = DURATION_MAP.find((d) => d.ms === ms);
  if (exact) return exact.label;
  const hours = ms / 3600000;
  if (hours === Math.floor(hours)) return `${hours}h`;
  const minutes = ms / 60000;
  if (minutes === Math.floor(minutes)) return `${minutes}m`;
  return `${ms}ms`;
}

function msToLabel(ms: number): string {
  const hours = ms / 3600000;
  if (hours >= 24) {
    const days = hours / 24;
    if (days === Math.floor(days)) return `${days}d`;
    return `${hours.toFixed(1)}h`;
  }
  if (hours === Math.floor(hours)) return `${hours}h`;
  return `${hours.toFixed(1)}h`;
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: ocx cron link <follower_id> <source_id> <multiplier>");
    console.log("  Sync follower cron frequency to source × multiplier");
    process.exit(0);
  }

  if (args.length !== 3) {
    console.error("Usage: ocx cron link <follower_id> <source_id> <multiplier>");
    process.exit(1);
  }

  const [followerId, sourceId, multStr] = args;
  const multiplier = parseFloat(multStr);

  if (isNaN(multiplier) || multiplier < 1) {
    console.error(`ERROR: multiplier must be >= 1, got '${multStr}'`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(JOBS_PATH, "utf-8"));
  const jobs = new Map<string, any>();
  for (const j of data.jobs ?? []) jobs.set(j.id, j);

  const follower = jobs.get(followerId);
  const source = jobs.get(sourceId);

  if (!follower) { console.error(`ERROR: follower cron '${followerId}' not found`); process.exit(1); }
  if (!source) { console.error(`ERROR: source cron '${sourceId}' not found`); process.exit(1); }

  const fname = follower.name ?? "";
  if (!fname.includes("[ADAPTIVE]") && !fname.includes("[LINKED")) {
    console.error(`ERROR: follower '${fname}' missing [ADAPTIVE] or [LINKED] tag`);
    process.exit(1);
  }

  if (follower.schedule?.kind !== "every") {
    console.error(`ERROR: follower schedule kind is '${follower.schedule?.kind}', must be 'every'`);
    process.exit(1);
  }
  if (source.schedule?.kind !== "every") {
    console.error(`ERROR: source schedule kind is '${source.schedule?.kind}', must be 'every'`);
    process.exit(1);
  }

  const sourceMs = source.schedule.everyMs ?? 86400000;
  const currentMs = follower.schedule.everyMs ?? 86400000;
  let targetMs = Math.round(sourceMs * multiplier);
  targetMs = Math.max(MIN_MS, Math.min(MAX_MS, targetMs));

  console.log(`Source:     ${source.name ?? sourceId} — every ${msToLabel(sourceMs)}`);
  console.log(`Multiplier: ${multiplier}x`);
  console.log(`Follower:   ${follower.name ?? followerId}`);
  console.log(`Before:     every ${msToLabel(currentMs)}`);
  console.log(`Target:     every ${msToLabel(targetMs)}`);

  if (targetMs === currentMs) {
    console.log("Already at target. No change.");
    process.exit(0);
  }

  const duration = msToDuration(targetMs);

  try {
    execSync(`openclaw cron edit ${followerId} --every ${duration}`, { stdio: "pipe" });
  } catch (e: any) {
    console.error("ERROR: openclaw cron edit failed");
    if (e.stderr) console.error(e.stderr.toString());
    if (e.stdout) console.error(e.stdout.toString());
    process.exit(1);
  }

  console.log(`After:      every ${msToLabel(targetMs)} ✓`);
}

main();
