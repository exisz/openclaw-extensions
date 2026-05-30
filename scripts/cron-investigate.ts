#!/usr/bin/env node
/**
 * ocx cron investigate — Investigate cron session history for an agent.
 * Wraps `openclaw cron runs` + `openclaw cron list` to provide agent-centric investigation.
 *
 * Usage:
 *   ocx cron investigate --agent <id> --last <n>
 *   ocx cron investigate --agent <id> --last <n> --errors-only
 *   ocx cron investigate --agent <id> --session <sessionId>
 *   ocx cron investigate --agent <id> --session <sessionId>          # compact index (default)
 *   ocx cron investigate --agent <id> --session <sessionId> --details
 *   ocx cron investigate --agent <id> --session <sessionId> --full
 *   ocx cron investigate --agent <id> --session <sessionId> --range 8-12
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const agentId = getFlag('--agent');
const last = getFlag('--last') || '10';
const sessionId = getFlag('--session');
const errorsOnly = args.includes('--errors-only');
const full = args.includes('--full');
const details = args.includes('--details');
const range = getFlag('--range');

function usage(): void {
  console.error('Usage: ocx cron investigate --agent <agentId> [--last <n>] [--errors-only] [--session <sessionId>] [--details] [--full] [--range <n|n-m>]');
  console.error('');
  console.error('Options:');
  console.error('  --agent <id>      Agent id (required)');
  console.error('  --last <n>        Number of recent runs to show (default: 10)');
  console.error('  --errors-only     Filter overview to error runs');
  console.error('  --session <sid>   Show compact session index (prefix ok)');
  console.error('  --details         Show sanitized session text/tool chain (truncated)');
  console.error('  --full            Do not truncate session text/tool results');
  console.error('  --range <n|n-m>   Show only session entries in this 1-based range');
}

if (!agentId) {
  usage();
  process.exit(1);
}

function clip(value: unknown, limit: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (full || text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

function parseRange(spec: string | undefined): [number, number] | undefined {
  if (!spec) return undefined;
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) {
    console.error(`❌ Invalid --range '${spec}'. Use N or N-M.`);
    process.exit(1);
  }
  const start = Number(m[1]);
  const end = Number(m[2] || m[1]);
  if (start < 1 || end < start) {
    console.error(`❌ Invalid --range '${spec}'. Use N or N-M.`);
    process.exit(1);
  }
  return [start, end];
}

function findSessionFile(agent: string, sid: string): string | undefined {
  const dir = join(homedir(), '.openclaw', 'agents', agent, 'sessions');
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.includes('.trajectory'));
  const exact = files.find((f) => f === `${sid}.jsonl`);
  if (exact) return join(dir, exact);
  const prefixed = files.find((f) => f.startsWith(sid));
  return prefixed ? join(dir, prefixed) : undefined;
}

function rawText(content: any[]): string | undefined {
  const parts = content
    .filter((c) => c?.type === 'text')
    .map((c) => c.text)
    .filter(Boolean);
  if (!parts.length) return undefined;
  return parts.join('\n');
}

function contentText(content: any[], limit: number): string | undefined {
  const text = rawText(content);
  if (!text) return undefined;
  return clip(text, limit).replace(/\n/g, '\n   ');
}

function oneLine(value: unknown, limit: number): string {
  return clip(value, limit).replace(/\s+/g, ' ').trim();
}

type DisplayItem = {
  kind: 'USER' | 'ASSISTANT' | 'TOOL CALL' | 'TOOL RESULT';
  name?: string;
  text: string;
  chars: number;
};

function buildDisplayItems(obj: any): DisplayItem[] {
  if (obj.type !== 'message') return [];
  const msg = obj.message || {};
  const role = msg.role;
  const content = Array.isArray(msg.content) ? msg.content : [];
  const displayItems: DisplayItem[] = [];

  if (role === 'user') {
    const text = rawText(content);
    if (text) displayItems.push({ kind: 'USER', text, chars: text.length });
  } else if (role === 'assistant') {
    for (const c of content) {
      if (c?.type === 'toolCall') {
        const text = typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments || {});
        displayItems.push({ kind: 'TOOL CALL', name: c.name, text, chars: text.length });
      }
      if (c?.type === 'text' && c.text) {
        displayItems.push({ kind: 'ASSISTANT', text: c.text, chars: c.text.length });
      }
    }
  } else if (role === 'toolResult') {
    const name = obj.toolName || msg.toolName || 'toolResult';
    const text = rawText(content) || JSON.stringify(content);
    displayItems.push({ kind: 'TOOL RESULT', name, text, chars: text.length });
  }

  return displayItems;
}

function printCompactItem(entryNo: number, item: DisplayItem): void {
  const label = item.name ? `${item.kind} ${item.name}` : item.kind;
  const line = oneLine(item.text, item.kind === 'TOOL RESULT' ? 180 : 220);
  const suffix = item.chars > line.length ? ` (${item.chars} chars)` : '';
  console.log(`${String(entryNo).padStart(3, ' ')}. ${label}: ${line}${suffix}`);
}

function printDetailedItem(entryNo: number, item: DisplayItem): void {
  const label = item.name ? `${item.kind} ${item.name}` : item.kind;
  const limit = item.kind === 'TOOL CALL' ? 300 : item.kind === 'USER' ? 500 : 700;
  const text = clip(item.text, limit).replace(/\n/g, '\n   ');
  console.log(`${String(entryNo).padStart(3, ' ')}. ${label} ${text}`);
  console.log('');
}

function printSessionHistory(agent: string, sid: string): boolean {
  const file = findSessionFile(agent, sid);
  if (!file) return false;
  const wanted = parseRange(range);
  const compact = !details && !full && !wanted;
  const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  let entryNo = 0;
  console.log(`📋 Session: ${sid}`);
  console.log(`   File: ${file}`);
  if (compact) {
    console.log('   Compact index: reasoning/thinking hidden; tool results are one-line previews.');
    console.log('   Drill down with: ocx cron investigate --agent <id> --session <sid> --range N-M [--full]\n');
  } else {
    console.log('   输出已过滤 reasoning/thinking，仅显示 user/assistant 文本、toolCall、toolResult。\n');
  }

  for (const line of lines) {
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    for (const item of buildDisplayItems(obj)) {
      entryNo += 1;
      if (wanted && (entryNo < wanted[0] || entryNo > wanted[1])) continue;
      if (compact) printCompactItem(entryNo, item);
      else printDetailedItem(entryNo, item);
    }
  }
  if (compact) {
    console.log(`\nTotal display entries: ${entryNo}`);
  }
  return true;
}

// Step 1: Find cron job(s) for this agent
let cronId: string | undefined;

try {
  const listOutput = execSync('openclaw cron list --json 2>/dev/null', { encoding: 'utf-8', timeout: 15000 });
  const data = JSON.parse(listOutput);

  function findCronJobs(obj: any, results: any[] = []): any[] {
    if (typeof obj !== 'object' || obj === null) return results;
    if (Array.isArray(obj)) {
      for (const item of obj) findCronJobs(item, results);
    } else {
      if (obj.agentId === agentId) results.push(obj);
      else for (const v of Object.values(obj)) {
        if (typeof v === 'object') findCronJobs(v, results);
      }
    }
    return results;
  }

  const jobs = findCronJobs(data);

  if (jobs.length === 0) {
    console.error(`❌ No cron jobs found for agent '${agentId}'`);
    process.exit(1);
  }

  if (jobs.length === 1) {
    cronId = jobs[0].id;
  } else {
    console.log(`Found ${jobs.length} cron jobs for ${agentId}:\n`);
    for (const job of jobs) {
      console.log(`  ${job.id}  ${job.name || '(unnamed)'}  [${job.state?.lastRunStatus || 'unknown'}]`);
    }
    cronId = jobs[0].id;
    console.log(`\nUsing first: ${cronId}\n`);
  }
} catch (e: any) {
  console.error('❌ Failed to list cron jobs:', e.message);
  process.exit(1);
}

// Step 2: Get run history
if (sessionId) {
  if (printSessionHistory(agentId, sessionId)) process.exit(0);
  console.log(`📋 Session: ${sessionId}`);
  console.log('   Local session history not found; falling back to openclaw cron runs.\n');
  try {
    const output = execSync(`openclaw cron runs --id ${cronId} --limit 50 2>/dev/null`, { encoding: 'utf-8', timeout: 30000 });
    const parsed = JSON.parse(output);
    const entry = parsed.entries?.find((e: any) => e.sessionId === sessionId || e.sessionKey?.includes(sessionId));
    if (entry) {
      console.log(JSON.stringify(entry, null, 2));
    } else {
      console.log(`Session ${sessionId} not found in recent ${parsed.entries?.length || 0} runs.`);
    }
  } catch (e: any) {
    console.error('❌ Failed to fetch runs:', e.message);
    process.exit(1);
  }
} else {
  try {
    const output = execSync(`openclaw cron runs --id ${cronId} --limit ${last} 2>/dev/null`, { encoding: 'utf-8', timeout: 30000 });
    const parsed = JSON.parse(output);
    let entries = parsed.entries || [];
    if (errorsOnly) entries = entries.filter((entry: any) => entry.status === 'error' || entry.error);

    console.log(`⏰ Cron Investigation — ${agentId}`);
    console.log(`   Job: ${cronId}`);
    console.log(`   Showing ${entries.length} run(s)${errorsOnly ? ' with errors' : ''}\n`);
    console.log('─'.repeat(80));

    for (const entry of entries) {
      const date = new Date(entry.ts).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
      const duration = entry.durationMs ? `${Math.round(entry.durationMs / 1000)}s` : '?';
      const status = entry.status === 'ok' ? '✅' : '❌';

      console.log(`${status} ${date}  [${duration}]  ${entry.status}`);
      if (entry.error) console.log(`   Error: ${entry.error}`);
      if (entry.summary) {
        const firstLine = entry.summary.split('\n').find((l: string) => l.trim()) || '';
        console.log(`   ${firstLine.slice(0, 120)}`);
      }
      if (entry.sessionKey) console.log(`   Session: ${entry.sessionKey}`);
      console.log('');
    }

    console.log('─'.repeat(80));
    console.log(`Total runs in history: ${parsed.total || entries.length}`);
  } catch (e: any) {
    console.error('❌ Failed to fetch runs:', e.message);
    process.exit(1);
  }
}
