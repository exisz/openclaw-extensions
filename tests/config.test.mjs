import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertIncludeFilesUnchanged, includeRawHash, mergeConfig, splitConfig } from "../dist/config.js";

test("merge returns the authored resolved snapshot unchanged", () => {
  const source = { agents: { list: [{ id: "main" }] }, bindings: [{ agentId: "main" }], gateway: { port: 1 } };
  assert.deepEqual(mergeConfig(source), source);
});

test("split extracts only agents and bindings", () => {
  const source = { agents: { defaults: {} }, bindings: [], gateway: { port: 1 } };
  const result = splitConfig(source);
  assert.deepEqual(result.root, { agents: { $include: "./agents.json5" }, bindings: { $include: "./bindings.json5" }, gateway: { port: 1 } });
  assert.deepEqual(result.files, { "agents.json5": source.agents, "bindings.json5": source.bindings });
});

test("split/merge payload round trip is lossless", () => {
  const source = { agents: { list: [{ id: "a" }] }, bindings: [{ agentId: "a", match: { channel: "discord" } }], auth: { x: true } };
  const split = splitConfig(source);
  const reconstructed = { ...split.root, agents: split.files["agents.json5"], bindings: split.files["bindings.json5"] };
  assert.deepEqual(mergeConfig(reconstructed), source);
});

test("env templates and SecretRef objects are never materialized by transforms", () => {
  const source = { agents: { defaults: { apiKey: "${OPENAI_API_KEY}" } }, bindings: [], gateway: { auth: { token: { source: "env", provider: "default", id: "GATEWAY_TOKEN" } } } };
  const split = splitConfig(source);
  const serialized = JSON.stringify({ root: split.root, files: split.files });
  assert.match(serialized, /\$\{OPENAI_API_KEY\}/);
  assert.match(serialized, /GATEWAY_TOKEN/);
  assert.doesNotMatch(serialized, /actual-secret/);
});

test("missing optional split sections are tolerated", () => {
  assert.deepEqual(splitConfig({ gateway: {} }), { root: { gateway: {} }, files: {} });
});

test("merge rejects a concurrently changed include file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ocx-config-hash-test-"));
  const included = join(dir, "agents.json5");
  writeFileSync(included, "{list:[]}\n");
  const expected = includeRawHash(readFileSync(included, "utf8"));
  writeFileSync(included, "{list:[{id:'changed'}]}\n");
  assert.throws(() => assertIncludeFilesUnchanged({ [included]: expected }), /changed concurrently/);
});

const hasOpenClaw = spawnSync("openclaw", ["--version"], { encoding: "utf8" }).status === 0;

test("CLI merge/split preserves authored env refs and SecretRef objects", { skip: !hasOpenClaw && "OpenClaw is not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ocx-config-test-"));
  const config = join(dir, "openclaw.json");
  writeFileSync(join(dir, "agents.json5"), '{defaults:{workspace:"/tmp"},list:[{id:"main"}]}\n');
  writeFileSync(join(dir, "bindings.json5"), '[]\n');
  writeFileSync(config, '{agents:{"$include":"./agents.json5"},bindings:{"$include":"./bindings.json5"},gateway:{auth:{token:"${TEST_TOKEN}"}},secrets:{providers:{example:{source:"env"}}}}\n');
  const env = { ...process.env, TEST_TOKEN: "actual-secret-that-must-never-be-written" };
  const merge = spawnSync(process.execPath, ["dist/config.js", "merge", "--config", config], { cwd: process.cwd(), env, encoding: "utf8" });
  assert.equal(merge.status, 0, merge.stderr);
  const merged = readFileSync(config, "utf8");
  assert.match(merged, /\$\{TEST_TOKEN\}/);
  assert.doesNotMatch(merged, /actual-secret-that-must-never-be-written/);
  assert.doesNotMatch(merged, /\$include/);
  const validateMerged = spawnSync("openclaw", ["config", "validate"], { env: { ...env, OPENCLAW_CONFIG_PATH: config }, encoding: "utf8" });
  assert.equal(validateMerged.status, 0, validateMerged.stderr);
  const split = spawnSync(process.execPath, ["dist/config.js", "split", "--config", config], { cwd: process.cwd(), env, encoding: "utf8" });
  assert.equal(split.status, 0, split.stderr);
  const splitRoot = readFileSync(config, "utf8");
  assert.match(splitRoot, /\$\{TEST_TOKEN\}/);
  assert.doesNotMatch(splitRoot, /actual-secret-that-must-never-be-written/);
  assert.match(splitRoot, /\$include/);
  const validateSplit = spawnSync("openclaw", ["config", "validate"], { env: { ...env, OPENCLAW_CONFIG_PATH: config }, encoding: "utf8" });
  assert.equal(validateSplit.status, 0, validateSplit.stderr);
});
