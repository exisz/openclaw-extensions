#!/usr/bin/env node
/**
 * ocx cron investigate — Investigate cron session history for an agent.
 * Wraps `openclaw cron runs` + `openclaw cron list` to provide agent-centric investigation.
 *
 * Usage:
 *   ocx cron investigate --agent <id> --last <n>
 *   ocx cron investigate --agent <id> --session <sessionId>
 */
import { execSync } from 'node:child_process';
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
if (!agentId) {
    console.error('Usage: dna cron investigate --agent <agentId> [--last <n>] [--session <sessionId>]');
    console.error('');
    console.error('Options:');
    console.error('  --agent <id>      Agent id (required)');
    console.error('  --last <n>        Number of recent runs to show (default: 10)');
    console.error('  --session <sid>   Show details for a specific session');
    process.exit(1);
}
// Step 1: Find cron job(s) for this agent
let cronId;
try {
    const listOutput = execSync('openclaw cron list --json 2>/dev/null', { encoding: 'utf-8', timeout: 15000 });
    // Parse the JSON — handle nested structures
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
    // Show specific session — use sessions_history via openclaw if available
    console.log(`📋 Session: ${sessionId}`);
    console.log(`   (Use sessions_history or openclaw cron runs to inspect further)\n`);
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
    // Show last N runs
    try {
        const output = execSync(`openclaw cron runs --id ${cronId} --limit ${last} 2>/dev/null`, { encoding: 'utf-8', timeout: 30000 });
        const parsed = JSON.parse(output);
        const entries = parsed.entries || [];
        console.log(`⏰ Cron Investigation — ${agentId}`);
        console.log(`   Job: ${cronId}`);
        console.log(`   Showing last ${entries.length} runs\n`);
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