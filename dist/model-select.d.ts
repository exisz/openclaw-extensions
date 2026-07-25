#!/usr/bin/env node
import { type ModelWeight } from "./workspace.js";
export declare function normalizeSubagentTier(value: string | undefined): string;
export declare function pickSubagentModel(tierInput?: string): {
    model: string;
    tier: string;
    weights: readonly ModelWeight[];
    policyPath: string;
};
export declare function runModelSelectCli(args: string[]): void;
//# sourceMappingURL=model-select.d.ts.map