import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const OCX_WORKSPACE_DIR = process.env.OCX_WORKSPACE_DIR || join(process.env.HOME || "", ".openclaw/.ocx");
export const OCX_INJECTIONS_DIR = join(OCX_WORKSPACE_DIR, "injections");
export const OCX_MODEL_POLICY_PATH = join(OCX_WORKSPACE_DIR, "model-policy.json");
export const DEFAULT_MODEL_POLICY = {
    // Generic provider-agnostic placeholder. Real deployments should override this
    // in ~/.openclaw/.ocx/model-policy.json.
    subagent: {
        default: [["default", 100]],
    },
    aliases: {},
    defaultTier: "default",
};
export function ensureOcxWorkspace() {
    mkdirSync(OCX_INJECTIONS_DIR, { recursive: true });
    if (!existsSync(OCX_MODEL_POLICY_PATH)) {
        writeFileSync(OCX_MODEL_POLICY_PATH, `${JSON.stringify(DEFAULT_MODEL_POLICY, null, 2)}\n`);
    }
}
function isModelWeight(value) {
    return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number" && value[1] > 0;
}
export function loadModelPolicy() {
    ensureOcxWorkspace();
    try {
        const parsed = JSON.parse(readFileSync(OCX_MODEL_POLICY_PATH, "utf-8"));
        const subagent = {};
        for (const [tier, weights] of Object.entries(parsed.subagent || {})) {
            const valid = Array.isArray(weights) ? weights.filter(isModelWeight) : [];
            if (valid.length)
                subagent[tier] = valid;
        }
        return {
            subagent: Object.keys(subagent).length ? subagent : DEFAULT_MODEL_POLICY.subagent,
            aliases: { ...DEFAULT_MODEL_POLICY.aliases, ...(parsed.aliases || {}) },
            defaultTier: parsed.defaultTier || DEFAULT_MODEL_POLICY.defaultTier,
        };
    }
    catch {
        return DEFAULT_MODEL_POLICY;
    }
}
export function workspaceRelative(path) {
    return path.startsWith(OCX_WORKSPACE_DIR) ? path.slice(OCX_WORKSPACE_DIR.length + 1) : path;
}
//# sourceMappingURL=workspace.js.map