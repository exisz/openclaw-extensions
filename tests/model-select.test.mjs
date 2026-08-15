import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("model policy check detects stale entries and reports the default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ocx-model-check-"));
  writeFileSync(join(dir, "model-policy.json"), JSON.stringify({
    subagent: { high: [["codex/gpt-current", 80], ["claude/old", 20]] },
    aliases: {}, defaultTier: "high"
  }));
  process.env.OCX_WORKSPACE_DIR = dir;
  const { checkModelPolicy } = await import(`../dist/model-select.js?test=${Date.now()}`);
  const result = checkModelPolicy([
    { key: "codex/gpt-current", available: true, tags: ["default"] },
    { key: "claude/old", available: false, missing: true, tags: [] }
  ]);
  assert.deepEqual(result.configured, ["codex/gpt-current", "claude/old"]);
  assert.deepEqual(result.unavailable, ["claude/old"]);
  assert.equal(result.defaultModel, "codex/gpt-current");
});
