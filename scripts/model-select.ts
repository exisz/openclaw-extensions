#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { loadModelPolicy, OCX_MODEL_POLICY_PATH, type ModelWeight } from "./workspace.js";

type OpenClawModel = { key?: string; available?: boolean; missing?: boolean; tags?: string[] };

export function checkModelPolicy(models: OpenClawModel[]): {
  configured: string[];
  unavailable: string[];
  defaultModel?: string;
} {
  const policy = loadModelPolicy();
  const configured = [...new Set(Object.values(policy.subagent).flat().map(([model]) => model))];
  const available = new Set(models.filter((model) => model.available !== false && !model.missing).map((model) => model.key).filter(Boolean));
  return {
    configured,
    unavailable: configured.filter((model) => !available.has(model)),
    defaultModel: models.find((model) => model.tags?.includes("default"))?.key,
  };
}

export function loadOpenClawModels(): OpenClawModel[] {
  const raw = execFileSync("openclaw", ["models", "list", "--json"], { encoding: "utf8" });
  const parsed = JSON.parse(raw) as { models?: OpenClawModel[] };
  return parsed.models || [];
}

export function normalizeSubagentTier(value: string | undefined): string {
  const policy = loadModelPolicy();
  if (value && policy.subagent[value]) return value;
  if (value && policy.aliases[value] && policy.subagent[policy.aliases[value]]) return policy.aliases[value];
  return policy.defaultTier;
}

export function pickSubagentModel(tierInput?: string): { model: string; tier: string; weights: readonly ModelWeight[]; policyPath: string } {
  const policy = loadModelPolicy();
  const tier = normalizeSubagentTier(tierInput);
  const weights = policy.subagent[tier] || policy.subagent[policy.defaultTier];
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [model, weight] of weights) {
    roll -= weight;
    if (roll <= 0) return { model, tier, weights, policyPath: OCX_MODEL_POLICY_PATH };
  }
  return { model: weights[weights.length - 1][0], tier, weights, policyPath: OCX_MODEL_POLICY_PATH };
}

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export function runModelSelectCli(args: string[]): void {
  const cmd = args[0];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    const policy = loadModelPolicy();
    console.log(`ocx model — OpenClaw-specific model selection\n\nUsage:\n  ocx model subagent --tier high [--format model|json]\n  ocx model check [--format text|json]\n\nPolicy file:\n  ${OCX_MODEL_POLICY_PATH}\n\nTiers:\n${Object.entries(policy.subagent).map(([tier, weights]) => `  ${tier}: ${weights.map(([model, weight]) => `${weight}% ${model}`).join(", ")}`).join("\n")}\n\nAliases:\n${Object.entries(policy.aliases).map(([alias, tier]) => `  ${alias} → ${tier}`).join("\n")}`);
    return;
  }
  if (cmd === "check") {
    try {
      const result = checkModelPolicy(loadOpenClawModels());
      if (argValue(args, "--format") === "json") {
        console.log(JSON.stringify({ ...result, policyPath: OCX_MODEL_POLICY_PATH }, null, 2));
      } else {
        console.log(`Policy: ${OCX_MODEL_POLICY_PATH}`);
        console.log(`OpenClaw default: ${result.defaultModel || "unknown"}`);
        for (const model of result.configured) {
          console.log(`${result.unavailable.includes(model) ? "❌" : "✅"} ${model}`);
        }
      }
      if (result.unavailable.length) process.exitCode = 1;
    } catch (error) {
      console.error(`Unable to query OpenClaw models: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
    return;
  }
  if (cmd !== "subagent") {
    console.error(`Unknown model command: ${cmd}`);
    process.exit(1);
  }

  const selected = pickSubagentModel(argValue(args, "--tier"));
  const format = argValue(args, "--format") === "json" ? "json" : "model";
  if (format === "json") {
    console.log(JSON.stringify({ ...selected, policy: "ocx_workspace_model_policy" }));
  } else {
    console.log(selected.model);
  }
}

if (process.argv[1]?.endsWith("/model-select.js") || process.argv[1]?.endsWith("/model-select.ts")) {
  runModelSelectCli(process.argv.slice(2));
}
