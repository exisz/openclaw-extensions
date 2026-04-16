#!/usr/bin/env node --experimental-strip-types
/**
 * Adaptive cron frequency adjuster — decrease frequency (longer interval).
 *
 * Usage: ocx cron down <cron_id> [--step N]
 *
 * Safety: Only adjusts crons whose name contains [ADAPTIVE].
 * Schedule kind must be "every". anchorMs is never changed.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const JOBS_PATH = join(homedir(), ".openclaw/cron/jobs.json");

// Tiers: index 0 = longest (168h), last = shortest (1h)
const TIERS: Array<{ ms: number; label: string }> = [
  { ms: 604800000, label: "168h" },
  { ms: 259200000, label: "72h" },
  { ms: 172800000, label: "48h" },
  { ms: 86400000, label: "24h" },
  { ms: 43200000, label: "12h" },
  { ms: 28800000, label: "8h" },
  { ms: 21600000, label: "6h" },
  { ms: 14400000, label: "4h" },
  { ms: 10800000, label: "3h" },
  { ms: 7200000, label: "2h" },
  { ms: 3600000, label: "1h" },
];

function findTierIndex(ms: number): number {
  const idx = TIERS.findIndex((t) => t.ms === ms);
  if (idx !== -1) return idx;
  let best = 0;
  let bestDiff = Math.abs(TIERS[0].ms - ms);
  for (let i = 1; i < TIERS.length; i++) {
    const diff = Math.abs(TIERS[i].ms - ms);
    if (diff < bestDiff) {
      best = i;
      bestDiff = diff;
    }
  }
  return best;
}

function main(): void {
  const args = process.argv.slice(2);
  let step = 1;

  const stepIdx = args.indexOf("--step");
  if (stepIdx !== -1) {
    const val = parseInt(args[stepIdx + 1], 10);
    if (isNaN(val) || val < 1) {
      console.error("ERROR: --step must be a positive integer");
      process.exit(1);
    }
    step = val;
    args.splice(stepIdx, 2);
  }

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: ocx cron down <cron_id> [--step N]");
    console.log("  Decrease cron frequency (longer interval) by N tiers (default 1)");
    process.exit(0);
  }

  const cronId = args[0];

  const data = JSON.parse(readFileSync(JOBS_PATH, "utf-8"));
  const job = data.jobs?.find((j: any) => j.id === cronId);

  if (!job) {
    console.error(`ERROR: cron id '${cronId}' not found in ${JOBS_PATH}`);
    process.exit(1);
  }

  if (!job.name?.includes("[ADAPTIVE]")) {
    console.error(`ERROR: cron '${job.name}' does not have [ADAPTIVE] in name. Refusing to adjust.`);
    process.exit(1);
  }

  if (job.schedule?.kind !== "every") {
    console.error(`ERROR: schedule kind is '${job.schedule?.kind}', not 'every'. Refusing to adjust.`);
    process.exit(1);
  }

  const currentMs = job.schedule.everyMs ?? 86400000;
  const currentIdx = findTierIndex(currentMs);
  const beforeLabel = `every ${TIERS[currentIdx].label}`;

  // down = move to lower index (longer interval)
  const newIdx = Math.max(currentIdx - step, 0);

  if (newIdx === currentIdx) {
    console.log("Already at lowest frequency tier.");
    console.log(`  Current: ${beforeLabel}`);
    process.exit(0);
  }

  const newTier = TIERS[newIdx];
  const afterLabel = `every ${newTier.label}`;

  try {
    execSync(`openclaw cron edit ${cronId} --every ${newTier.label}`, {
      stdio: "pipe",
    });
  } catch (e: any) {
    console.error(`ERROR: openclaw cron edit failed`);
    if (e.stderr) console.error(e.stderr.toString());
    if (e.stdout) console.error(e.stdout.toString());
    process.exit(1);
  }

  console.log(`Before: ${beforeLabel}`);
  console.log(`After:  ${afterLabel}`);
  console.log(`Direction: down (step=${step})`);
}

main();
