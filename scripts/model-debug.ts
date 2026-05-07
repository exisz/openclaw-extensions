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

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';

const args = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

if (hasFlag('--help') || hasFlag('-h') || args.length === 0) {
  console.log('🔍 ocx model-debug — Diagnose model call failures');
  console.log('');
  console.log('Usage:');
  console.log('  ocx model-debug --agent <id>');
  console.log('  ocx model-debug --agent <id> --channel <channel_id>');
  console.log('  ocx model-debug --agent <id> --last <n>   (default: 5 sessions)');
  console.log('  ocx model-debug --session <file-path-or-session-id>');
  console.log('');
  console.log('What it checks:');
  console.log('  1. Trajectory files → model errors, stopReason, errorMessage');
  console.log('  2. 0-token calls (model ran but produced nothing)');
  console.log('  3. Fallback activations');
  console.log('  4. Discord model-picker selection history');
  console.log('  5. Gateway error log snippets around failure time');
  process.exit(0);
}

const agentId = getFlag('--agent');
const channelFilter = getFlag('--channel');
const lastN = parseInt(getFlag('--last') || '5', 10);
const sessionArg = getFlag('--session');

const ocHome = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');

// ── helpers ────────────────────────────────────────────────────────────────

function formatTs(ts: number | string): string {
  return new Date(typeof ts === 'string' ? ts : ts).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function readJsonlSync(filePath: string): any[] {
  const results: any[] = [];
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { results.push(JSON.parse(trimmed)); } catch {}
    }
  } catch {}
  return results;
}

// ── trajectory analysis ────────────────────────────────────────────────────

interface RunSummary {
  file: string;
  sessionId: string;
  sessionKey?: string;
  ts?: string;
  provider?: string;
  model?: string;
  errors: string[];
  zeroTokenCalls: number;
  totalCalls: number;
  fallbackActivated: boolean;
  stopReasons: string[];
}

function analyzeTrajectory(filePath: string): RunSummary {
  const events = readJsonlSync(filePath);
  const summary: RunSummary = {
    file: filePath,
    sessionId: path.basename(filePath).replace('.trajectory.jsonl', ''),
    errors: [],
    zeroTokenCalls: 0,
    totalCalls: 0,
    fallbackActivated: false,
    stopReasons: [],
  };

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;

    if (ev.type === 'session.started') {
      summary.ts = ev.ts;
    }

    if (ev.type === 'trace.metadata') {
      summary.provider = ev.provider;
      summary.model = ev.model;
      if (!summary.sessionKey) summary.sessionKey = ev.sessionKey;
    }

    if (ev.type === 'model.completed') {
      summary.totalCalls++;
      const data = ev.data || {};

      // Check messagesSnapshot for errors
      const msgs: any[] = data.messagesSnapshot || [];
      for (const msg of msgs) {
        if (msg.role === 'assistant') {
          if (msg.stopReason === 'error' && msg.errorMessage) {
            summary.errors.push(msg.errorMessage);
          }
          if (msg.stopReason) {
            summary.stopReasons.push(msg.stopReason);
          }
          // model from individual message
          if (msg.model && !summary.model) summary.model = msg.model;
          if (msg.provider && !summary.provider) summary.provider = msg.provider;
        }
      }

      // Zero-token call (model fired but produced nothing)
      const usage = data.promptCache?.lastCallUsage;
      if (usage && usage.input === 0 && usage.output === 0) {
        summary.zeroTokenCalls++;
      }

      // Fallback
      if (data.usedFallback || data.fallbackModel) {
        summary.fallbackActivated = true;
      }

      // Top-level error
      if (data.error && !summary.errors.includes(data.error)) {
        summary.errors.push(data.error);
      }
    }
  }

  return summary;
}

// ── model picker history ───────────────────────────────────────────────────

function getPickerHistory(): Record<string, { recent: string[]; updatedAt: string }> {
  const pickerPath = path.join(ocHome, 'discord', 'model-picker-preferences.json');
  try {
    const raw = JSON.parse(fs.readFileSync(pickerPath, 'utf-8'));
    return raw.entries || {};
  } catch {
    return {};
  }
}

// ── gateway err log snippets ───────────────────────────────────────────────

function getGatewayErrSnippet(aroundTs: string, windowMs = 5 * 60 * 1000): string[] {
  const logPath = path.join(ocHome, 'logs', 'gateway.err.log');
  const results: string[] = [];
  try {
    const targetTime = new Date(aroundTs).getTime();
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+]+)\s/);
      if (!match) continue;
      const lineTime = new Date(match[1]).getTime();
      if (Math.abs(lineTime - targetTime) <= windowMs) {
        results.push(line.trim());
      }
    }
  } catch {}
  return results;
}

// ── main ───────────────────────────────────────────────────────────────────

function findTrajectoryFiles(agent: string, channelId?: string): string[] {
  const sessionsDir = path.join(ocHome, 'agents', agent, 'sessions');
  try {
    const all = fs.readdirSync(sessionsDir);
    let trajectories = all.filter(f => f.endsWith('.trajectory.jsonl'));
    if (channelId) {
      trajectories = trajectories.filter(f => f.includes(channelId));
    }
    // Sort by mtime descending
    const withMtime = trajectories.map(f => {
      const fp = path.join(sessionsDir, f);
      const stat = fs.statSync(fp);
      return { file: fp, mtime: stat.mtimeMs };
    });
    withMtime.sort((a, b) => b.mtime - a.mtime);
    return withMtime.slice(0, lastN).map(x => x.file);
  } catch (e: any) {
    console.error(`❌ Cannot read sessions dir for agent '${agent}': ${e.message}`);
    process.exit(1);
  }
}

function printRun(run: RunSummary, showGatewayLog: boolean) {
  const hasProblems = run.errors.length > 0 || run.zeroTokenCalls > 0 || run.fallbackActivated;
  const icon = hasProblems ? '❌' : '✅';
  const tsStr = run.ts ? formatTs(run.ts) : '?';

  console.log(`${icon} ${tsStr}`);
  console.log(`   Session: ${run.sessionId}`);
  if (run.sessionKey) console.log(`   Key:     ${run.sessionKey}`);
  console.log(`   Model:   ${run.provider ?? '?'}/${run.model ?? '?'}`);
  console.log(`   Calls:   ${run.totalCalls} total` +
    (run.zeroTokenCalls > 0 ? ` | ⚠️ ${run.zeroTokenCalls} zero-token` : '') +
    (run.fallbackActivated ? ' | 🔄 fallback activated' : ''));

  if (run.stopReasons.length > 0) {
    const unique = [...new Set(run.stopReasons)];
    console.log(`   Stop reasons: ${unique.join(', ')}`);
  }

  for (const err of run.errors) {
    console.log(`   🔴 Error: ${err}`);
  }

  if (showGatewayLog && run.ts) {
    const gatewayLines = getGatewayErrSnippet(run.ts);
    const relevant = gatewayLines.filter(l =>
      /error|fail|kimi|openrouter|moonshot|model|invalid/i.test(l)
    );
    if (relevant.length > 0) {
      console.log(`   📋 Gateway log (±5min):`);
      for (const l of relevant.slice(0, 5)) {
        console.log(`      ${l.slice(0, 200)}`);
      }
    }
  }

  console.log('');
}

// ── entry point ────────────────────────────────────────────────────────────

console.log('🔍 ocx model-debug\n');

// Model picker context
const pickerHistory = getPickerHistory();
if (Object.keys(pickerHistory).length > 0) {
  console.log('📱 Recent model picker selections:');
  const relevant = Object.entries(pickerHistory)
    .sort((a, b) => new Date(b[1].updatedAt).getTime() - new Date(a[1].updatedAt).getTime())
    .slice(0, 5);
  for (const [key, val] of relevant) {
    const last = val.recent?.[0] ?? '?';
    const ts = formatTs(val.updatedAt);
    console.log(`   ${ts}  ${key.split(':').slice(-2).join(':')}  →  ${last}`);
  }
  console.log('');
}

// Resolve trajectory files
let trajectoryFiles: string[] = [];

if (sessionArg) {
  if (fs.existsSync(sessionArg)) {
    trajectoryFiles = [sessionArg];
  } else {
    // Try to find by session id fragment across all agents
    const agentsDir = path.join(ocHome, 'agents');
    try {
      for (const a of fs.readdirSync(agentsDir)) {
        const sessDir = path.join(agentsDir, a, 'sessions');
        if (!fs.existsSync(sessDir)) continue;
        for (const f of fs.readdirSync(sessDir)) {
          if (f.includes(sessionArg) && f.endsWith('.trajectory.jsonl')) {
            trajectoryFiles.push(path.join(sessDir, f));
          }
        }
      }
    } catch {}
    if (trajectoryFiles.length === 0) {
      console.error(`❌ No trajectory file found matching: ${sessionArg}`);
      process.exit(1);
    }
  }
} else if (agentId) {
  trajectoryFiles = findTrajectoryFiles(agentId, channelFilter);
  if (trajectoryFiles.length === 0) {
    console.error(`❌ No trajectory files found for agent '${agentId}'` +
      (channelFilter ? ` (channel: ${channelFilter})` : ''));
    process.exit(1);
  }
  console.log(`📂 Agent: ${agentId}${channelFilter ? `  channel: ${channelFilter}` : ''}`);
  console.log(`   Analyzing ${trajectoryFiles.length} most recent session(s)\n`);
  console.log('─'.repeat(80));
  console.log('');
} else {
  console.error('❌ Provide --agent <id> or --session <path>');
  process.exit(1);
}

// Analyze and print
let errorCount = 0;
for (const f of trajectoryFiles) {
  const run = analyzeTrajectory(f);
  printRun(run, true);
  if (run.errors.length > 0) errorCount++;
}

console.log('─'.repeat(80));
const totalRuns = trajectoryFiles.length;
console.log(`Runs analyzed: ${totalRuns} | With errors: ${errorCount}`);

if (errorCount === 0 && totalRuns > 0) {
  console.log('✅ No model errors found in analyzed sessions.');
}
