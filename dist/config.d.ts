#!/usr/bin/env node
type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export declare const SPLIT_SECTIONS: {
    readonly agents: "agents.json5";
    readonly bindings: "bindings.json5";
};
export declare function sha256(value: string): string;
export declare function includeRawHash(value: string): string;
export declare function mergeConfig(sourceConfig: Record<string, Json>): Record<string, Json>;
export declare function splitConfig(sourceConfig: Record<string, Json>): {
    root: Record<string, Json>;
    files: Record<string, Json>;
};
export declare function assertIncludeFilesUnchanged(expected?: Record<string, string>): void;
export declare function runConfigCommand(argv?: string[]): Promise<void>;
export {};
//# sourceMappingURL=config.d.ts.map