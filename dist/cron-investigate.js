#!/usr/bin/env node
/**
 * ocx cron investigate — Investigate cron session history for an agent.
 * Wraps `openclaw cron runs` + `openclaw cron list` to provide agent-centric investigation.
 *
 * Usage:
 *   ocx cron investigate --agent <id> --last <n>
 *   ocx cron investigate --agent <id> --last <n> --errors-only
 *   ocx cron investigate --agent <id> --session <sessionId>
 *   ocx cron investigate --agent <id> --session <sessionId> --full
 *   ocx cron investigate --agent <id> --session <sessionId> --range 8-12
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const args = process.argv.slice(2);
function getFlag(name) {
    const idx = args.indexOf(name);
    if (idx === -1)
        return undefined;
    return args[idx + 1];
}
const agentId = getFlag('--agent');
const last = getFlag('--last') || '10';
const sessionId = getFlag('--session');
const errorsOnly = args.includes('--errors-only');
const full = args.includes('--full');
const range = getFlag('--range');
function usage() {
    console.error('Usage: ocx cron investigate --agent <agentId> [--last <n>] [--errors-only] [--session <sessionId>] [--full] [--range <n|n-m>]');
    console.error('');
    console.error('Options:');
    console.error('  --agent <id>      Agent id (required)');
    console.error('  --last <n>        Number of recent runs to show (default: 10)');
    console.error('  --errors-only     Filter overview to error runs');
    console.error('  --session <sid>   Show sanitized session tool/text chain (prefix ok)');
    console.error('  --full            Do not truncate session text/tool results');
    console.error('  --range <n|n-m>   Show only session entries in this 1-based range');
}
if (!agentId) {
    usage();
    process.exit(1);
}
function clip(value, limit) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (full || text.length <= limit)
        return text;
    return `${text.slice(0, limit)}…`;
}
function parseRange(spec) {
    if (!spec)
        return undefined;
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
function findSessionFile(agent, sid) {
    const dir = join(homedir(), '.openclaw', 'agents', agent, 'sessions');
    if (!existsSync(dir))
        return undefined;
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.includes('.trajectory'));
    const exact = files.find((f) => f === `${sid}.jsonl`);
    if (exact)
        return join(dir, exact);
    const prefixed = files.find((f) => f.startsWith(sid));
    return prefixed ? join(dir, prefixed) : undefined;
}
function contentText(content, limit) {
    const parts = content
        .filter((c) => c?.type === 'text')
        .map((c) => c.text)
        .filter(Boolean);
    if (!parts.length)
        return undefined;
    return clip(parts.join('\n'), limit).replace(/\n/g, '\n   ');
}
function printSessionHistory(agent, sid) {
    const file = findSessionFile(agent, sid);
    if (!file)
        return false;
    const wanted = parseRange(range);
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    let entryNo = 0;
    console.log(`📋 Session: ${sid}`);
    console.log(`   File: ${file}`);
    console.log('   输出已过滤 reasoning/thinking，仅显示 user/assistant 文本、toolCall、toolResult。\n');
    for (const line of lines) {
        let obj;
        try {
            obj = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (obj.type !== 'message')
            continue;
        const msg = obj.message || {};
        const role = msg.role;
        const content = Array.isArray(msg.content) ? msg.content : [];
        const displayItems = [];
        if (role === 'user') {
            const text = contentText(content, 500);
            if (text)
                displayItems.push(`USER ${text}`);
        }
        else if (role === 'assistant') {
            for (const c of content) {
                if (c?.type === 'toolCall')
                    displayItems.push(`TOOL CALL ${c.name} ${clip(c.arguments || {}, 300).replace(/\n/g, ' ')}`);
                if (c?.type === 'text' && c.text)
                    displayItems.push(`ASSISTANT ${clip(c.text, 700).replace(/\n/g, '\n   ')}`);
            }
        }
        else if (role === 'toolResult') {
            const name = obj.toolName || msg.toolName || 'toolResult';
            const text = contentText(content, 700) || clip(content, 700).replace(/\n/g, '\n   ');
            displayItems.push(`TOOL RESULT ${name} ${text}`);
        }
        for (const item of displayItems) {
            entryNo += 1;
            if (wanted && (entryNo < wanted[0] || entryNo > wanted[1]))
                continue;
            console.log(`${String(entryNo).padStart(3, ' ')}. ${item}`);
            console.log('');
        }
    }
    return true;
}
// Step 1: Find cron job(s) for this agent
let cronId;
try {
    const listOutput = execSync('openclaw cron list --json 2>/dev/null', { encoding: 'utf-8', timeout: 15000 });
    const data = JSON.parse(listOutput);
    function findCronJobs(obj, results = []) {
        if (typeof obj !== 'object' || obj === null)
            return results;
        if (Array.isArray(obj)) {
            for (const item of obj)
                findCronJobs(item, results);
        }
        else {
            if (obj.agentId === agentId)
                results.push(obj);
            else
                for (const v of Object.values(obj)) {
                    if (typeof v === 'object')
                        findCronJobs(v, results);
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
    }
    else {
        console.log(`Found ${jobs.length} cron jobs for ${agentId}:\n`);
        for (const job of jobs) {
            console.log(`  ${job.id}  ${job.name || '(unnamed)'}  [${job.state?.lastRunStatus || 'unknown'}]`);
        }
        cronId = jobs[0].id;
        console.log(`\nUsing first: ${cronId}\n`);
    }
}
catch (e) {
    console.error('❌ Failed to list cron jobs:', e.message);
    process.exit(1);
}
// Step 2: Get run history
if (sessionId) {
    if (printSessionHistory(agentId, sessionId))
        process.exit(0);
    console.log(`📋 Session: ${sessionId}`);
    console.log('   Local session history not found; falling back to openclaw cron runs.\n');
    try {
        const output = execSync(`openclaw cron runs --id ${cronId} --limit 50 2>/dev/null`, { encoding: 'utf-8', timeout: 30000 });
        const parsed = JSON.parse(output);
        const entry = parsed.entries?.find((e) => e.sessionId === sessionId || e.sessionKey?.includes(sessionId));
        if (entry) {
            console.log(JSON.stringify(entry, null, 2));
        }
        else {
            console.log(`Session ${sessionId} not found in recent ${parsed.entries?.length || 0} runs.`);
        }
    }
    catch (e) {
        console.error('❌ Failed to fetch runs:', e.message);
        process.exit(1);
    }
}
else {
    try {
        const output = execSync(`openclaw cron runs --id ${cronId} --limit ${last} 2>/dev/null`, { encoding: 'utf-8', timeout: 30000 });
        const parsed = JSON.parse(output);
        let entries = parsed.entries || [];
        if (errorsOnly)
            entries = entries.filter((entry) => entry.status === 'error' || entry.error);
        console.log(`⏰ Cron Investigation — ${agentId}`);
        console.log(`   Job: ${cronId}`);
        console.log(`   Showing ${entries.length} run(s)${errorsOnly ? ' with errors' : ''}\n`);
        console.log('─'.repeat(80));
        for (const entry of entries) {
            const date = new Date(entry.ts).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' });
            const duration = entry.durationMs ? `${Math.round(entry.durationMs / 1000)}s` : '?';
            const status = entry.status === 'ok' ? '✅' : '❌';
            console.log(`${status} ${date}  [${duration}]  ${entry.status}`);
            if (entry.error)
                console.log(`   Error: ${entry.error}`);
            if (entry.summary) {
                const firstLine = entry.summary.split('\n').find((l) => l.trim()) || '';
                console.log(`   ${firstLine.slice(0, 120)}`);
            }
            if (entry.sessionKey)
                console.log(`   Session: ${entry.sessionKey}`);
            console.log('');
        }
        console.log('─'.repeat(80));
        console.log(`Total runs in history: ${parsed.total || entries.length}`);
    }
    catch (e) {
        console.error('❌ Failed to fetch runs:', e.message);
        process.exit(1);
    }
}
//# sourceMappingURL=cron-investigate.js.map