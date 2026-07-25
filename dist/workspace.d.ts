export declare const OCX_WORKSPACE_DIR: string;
export declare const OCX_INJECTIONS_DIR: string;
export declare const OCX_MODEL_POLICY_PATH: string;
export type ModelWeight = readonly [string, number];
export type ModelPolicyFile = {
    subagent?: Record<string, ModelWeight[]>;
    aliases?: Record<string, string>;
    defaultTier?: string;
};
export declare const DEFAULT_MODEL_POLICY: Required<ModelPolicyFile>;
export declare function ensureOcxWorkspace(): void;
export declare function loadModelPolicy(): Required<ModelPolicyFile>;
export declare function workspaceRelative(path: string): string;
//# sourceMappingURL=workspace.d.ts.map