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

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const args = process.argv.slice(2);
const fixMode = args.includes('--fix');
const configArg = args[args.indexOf('--config') + 1];
const ocHome = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');
const configPath = configArg || path.join(ocHome, 'openclaw.json');

// ── load config ────────────────────────────────────────────────────────────

let config: any;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e: any) {
  console.error(`❌ Cannot read config: ${configPath}\n   ${e.message}`);
  process.exit(1);
}

const agentsDefaults = config?.agents?.defaults ?? {};
const agentsList: any[] = config?.agents?.list ?? [];

// Known valid model IDs = keys of agents.defaults.models
const knownModels = new Set<string>(Object.keys(agentsDefaults.models ?? {}));
// Add the primary default too
const primaryModel: string | undefined = agentsDefaults.model?.primary;
if (primaryModel) knownModels.add(primaryModel);

// ── issues collector ───────────────────────────────────────────────────────

interface Issue {
  path: string;
  value: string;
  reason: string;
  fixable: boolean;
}

const issues: Issue[] = [];

function checkModel(modelValue: any, location: string, fixable: boolean) {
  if (modelValue === undefined || modelValue === null) return;
  if (typeof modelValue !== 'string') {
    issues.push({ path: location, value: String(modelValue), reason: 'model value must be a string', fixable: false });
    return;
  }
  if (modelValue === 'default') {
    issues.push({
      path: location,
      value: modelValue,
      reason: '"default" is not a valid model ID — it resolves to openai/default which does not exist',
      fixable,
    });
    return;
  }
  if (knownModels.size > 0 && !knownModels.has(modelValue)) {
    issues.push({
      path: location,
      value: modelValue,
      reason: `not listed in agents.defaults.models — will fail at runtime if provider rejects it`,
      fixable: false,
    });
  }
}

// Check default primary
if (primaryModel) {
  checkModel(primaryModel, 'agents.defaults.model.primary', false);
}

// Check fallbacks
const fallbacks: string[] = agentsDefaults.model?.fallbacks ?? [];
for (let i = 0; i < fallbacks.length; i++) {
  checkModel(fallbacks[i], `agents.defaults.model.fallbacks[${i}]`, false);
}

// Check per-agent model overrides
for (const agent of agentsList) {
  if ('model' in agent) {
    checkModel(agent.model, `agents.list[${agent.id}].model`, true);
  }
}

// ── report ─────────────────────────────────────────────────────────────────

console.log('🩺 ocx doctor\n');

if (issues.length === 0) {
  console.log('✅ All model references look valid.');
  process.exit(0);
}

console.log(`Found ${issues.length} issue(s):\n`);
for (const issue of issues) {
  const fixTag = issue.fixable ? '  [--fix will remove this]' : '';
  console.log(`  ❌ ${issue.path}`);
  console.log(`     value:  "${issue.value}"`);
  console.log(`     reason: ${issue.reason}${fixTag}`);
  console.log('');
}

// ── fix mode ───────────────────────────────────────────────────────────────

if (fixMode) {
  const fixable = issues.filter(i => i.fixable);
  if (fixable.length === 0) {
    console.log('ℹ️  No auto-fixable issues.');
    process.exit(1);
  }

  // Build set of agent ids to fix
  const toFix = new Set<string>();
  for (const issue of fixable) {
    // path format: agents.list[station].model
    const match = issue.path.match(/agents\.list\[([^\]]+)\]\.model/);
    if (match) toFix.add(match[1]);
  }

  let fixed = 0;
  for (const agent of config.agents.list) {
    if (toFix.has(agent.id) && 'model' in agent) {
      console.log(`  🔧 Removing model override from agent '${agent.id}' (was: "${agent.model}")`);
      delete agent.model;
      fixed++;
    }
  }

  if (fixed > 0) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(`\n✅ Fixed ${fixed} agent(s). Run 'openclaw gateway restart' (or SIGUSR1) to reload.`);
  }

  process.exit(fixed > 0 ? 0 : 1);
}

process.exit(1);
