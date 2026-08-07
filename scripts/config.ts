#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, fsyncSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import JSON5 from "json5";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Snapshot = { path: string; raw?: string; hash?: string; parsed: Record<string, Json>; sourceConfig: Record<string, Json>; valid: boolean; issues?: Array<{ message?: string }> };
type Runtime = {
  readConfigFileSnapshotForWrite: () => Promise<{ snapshot: Snapshot; writeOptions: WriteOptions }>;
  replaceConfigFile: (params: Record<string, unknown>) => Promise<unknown>;
};
type WriteOptions = Record<string, unknown> & {
  includeFileHashesForWrite?: Record<string, string>;
};

export const SPLIT_SECTIONS = { agents: "agents.json5", bindings: "bindings.json5" } as const;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function includeRawHash(value: string): string {
  return sha256(`present\0${value}`);
}

export function mergeConfig(sourceConfig: Record<string, Json>): Record<string, Json> {
  return structuredClone(sourceConfig);
}

export function splitConfig(sourceConfig: Record<string, Json>): { root: Record<string, Json>; files: Record<string, Json> } {
  const root = structuredClone(sourceConfig);
  const files: Record<string, Json> = {};
  for (const [section, file] of Object.entries(SPLIT_SECTIONS)) {
    if (!(section in root)) continue;
    files[file] = root[section];
    root[section] = { $include: `./${file}` };
  }
  return { root, files };
}

function json(value: Json | Record<string, Json>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWrite(path: string, content: string): void {
  const temp = `${path}.ocx-tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const fd = openSync(temp, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
}

function backup(path: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${path}.ocx-backup-${stamp}`;
  copyFileSync(path, target);
  return target;
}

function assertUnchanged(path: string, originalRaw: string): void {
  const current = readFileSync(path, "utf8");
  if (sha256(current) !== sha256(originalRaw)) throw new Error(`Config changed concurrently: ${path}`);
}

export function assertIncludeFilesUnchanged(expected: Record<string, string> = {}): void {
  for (const [path, expectedHash] of Object.entries(expected)) {
    let current: string;
    try { current = readFileSync(path, "utf8"); }
    catch { throw new Error(`Included config changed or disappeared: ${path}`); }
    if (includeRawHash(current) !== expectedHash) throw new Error(`Included config changed concurrently: ${path}`);
  }
}

async function loadOpenClawRuntime(): Promise<Runtime> {
  const specifier = "openclaw/plugin-sdk/config-runtime";
  try {
    return await import(specifier) as Runtime;
  } catch (firstError) {
    try {
      const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
      return await import(pathToFileURL(join(globalRoot, "openclaw/dist/plugin-sdk/config-runtime.js")).href) as Runtime;
    } catch {
      throw new Error(`Cannot load OpenClaw config runtime. Is OpenClaw installed? (${String(firstError)})`);
    }
  }
}

export async function runConfigCommand(argv = process.argv.slice(2)): Promise<void> {
  const action = argv[0];
  if (action !== "merge" && action !== "split") {
    console.log("Usage: ocx config <merge|split> [--config PATH] [--dry-run]");
    return;
  }
  const dryRun = argv.includes("--dry-run");
  const configIndex = argv.indexOf("--config");
  const requestedPath = configIndex >= 0 ? argv[configIndex + 1] : undefined;
  if (configIndex >= 0 && !requestedPath) throw new Error("--config requires a path");

  const previousConfig = process.env.OPENCLAW_CONFIG_PATH;
  if (requestedPath) process.env.OPENCLAW_CONFIG_PATH = resolve(requestedPath);
  try {
    const runtime = await loadOpenClawRuntime();
    const { snapshot, writeOptions } = await runtime.readConfigFileSnapshotForWrite();
    if (!snapshot.valid) throw new Error(`OpenClaw config is invalid: ${(snapshot.issues || []).map(i => i.message).filter(Boolean).join("; ")}`);
    if (requestedPath && resolve(snapshot.path) !== resolve(requestedPath)) throw new Error(`OpenClaw loaded ${snapshot.path}, not requested ${requestedPath}`);
    const originalRaw = snapshot.raw ?? readFileSync(snapshot.path, "utf8");
    const configDir = dirname(snapshot.path);

    if (action === "merge") {
      if (dryRun) { console.log(`Would merge includes into ${snapshot.path}`); return; }
      assertIncludeFilesUnchanged(writeOptions.includeFileHashesForWrite);
      const backupPath = backup(snapshot.path);
      // Removing include ownership from the authored shape tells OpenClaw to
      // flatten it, while envSnapshotForRestore in writeOptions restores ${...}
      // and SecretRef authored values before the validated atomic write.
      const flattenedSnapshot = { ...snapshot, parsed: snapshot.sourceConfig };
      await runtime.replaceConfigFile({
        nextConfig: snapshot.sourceConfig,
        baseHash: snapshot.hash,
        snapshot: flattenedSnapshot,
        writeOptions: { ...writeOptions, includeFileHashesForWrite: {}, includeFileTargetsForWrite: {} },
      });
      console.log(`Merged config into ${snapshot.path}\nBackup: ${backupPath}`);
      return;
    }

    const alreadySplit = Object.entries(SPLIT_SECTIONS).every(([section, file]) => {
      const value = snapshot.parsed[section];
      return value !== null && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).length === 1 && (value as Record<string, Json>).$include === `./${file}`;
    });
    if (alreadySplit) { console.log(`Config is already split: ${snapshot.path}`); return; }
    // A merged root's parsed shape is the authored source of truth, so env
    // templates and SecretRef objects are copied without runtime expansion.
    const result = splitConfig(snapshot.parsed);
    const pending: Array<[string, string]> = [];
    for (const [file, value] of Object.entries(result.files)) {
      const target = join(configDir, file);
      const content = json(value);
      if (existsSync(target)) {
        let existing: unknown;
        try { existing = JSON5.parse(readFileSync(target, "utf8")); }
        catch { throw new Error(`Refusing to overwrite invalid split target: ${target}`); }
        if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error(`Refusing to overwrite non-equivalent split target: ${target}`);
      }
      pending.push([target, content]);
    }
    if (dryRun) { console.log(`Would split ${Object.keys(result.files).join(", ")} from ${snapshot.path}`); return; }
    const backupPath = backup(snapshot.path);
    for (const [target, content] of pending) if (!existsSync(target)) atomicWrite(target, content);
    assertUnchanged(snapshot.path, originalRaw);
    const splitSnapshot = { ...snapshot, parsed: snapshot.sourceConfig };
    await runtime.replaceConfigFile({ nextConfig: result.root, baseHash: snapshot.hash, snapshot: splitSnapshot, writeOptions });
    console.log(`Split config at ${snapshot.path}\nBackup: ${backupPath}`);
  } finally {
    if (requestedPath) {
      if (previousConfig === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = previousConfig;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runConfigCommand().catch(error => { console.error(`ocx config: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
}
