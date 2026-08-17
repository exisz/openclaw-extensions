#!/usr/bin/env node
import { type ModelWeight } from "./workspace.js";
type OpenClawModel = {
    key?: string;
    available?: boolean;
    missing?: boolean;
    tags?: string[];
};
export declare function checkModelPolicy(models: OpenClawModel[]): {
    configured: string[];
    unavailable: string[];
    defaultModel?: string;
};
export declare function loadOpenClawModels(): OpenClawModel[];
export declare function normalizeSubagentTier(value: string | undefined): string;
export declare function pickSubagentModel(tierInput?: string): {
    model: string;
    tier: string;
    weights: readonly ModelWeight[];
    policyPath: string;
};
export declare function runModelSelectCli(args: string[]): void;
export {};
//# sourceMappingURL=model-select.d.ts.map