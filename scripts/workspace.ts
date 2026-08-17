import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const OCX_WORKSPACE_DIR = process.env.OCX_WORKSPACE_DIR || join(process.env.HOME || "", ".openclaw/.ocx");
export const OCX_INJECTIONS_DIR = join(OCX_WORKSPACE_DIR, "injections");

export function ensureOcxWorkspace(): void {
  mkdirSync(OCX_INJECTIONS_DIR, { recursive: true });
}

export function workspaceRelative(path: string): string {
  return path.startsWith(OCX_WORKSPACE_DIR) ? path.slice(OCX_WORKSPACE_DIR.length + 1) : path;
}
