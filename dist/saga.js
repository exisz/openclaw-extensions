#!/usr/bin/env node
/**
 * ocx saga — staged prompt executor for agent lifecycle control.
 *
 * A saga reveals one stage at a time. The agent must submit a stage answer
 * before receiving the next stage prompt. This keeps execution order stable
 * while allowing later stages to critique and evolve the method.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
const ROOT = resolve(process.env.OCX_SAGA_ROOT || process.cwd());
const RUN_DIR = join(ROOT, ".agent-saga", "runs");
const SAGA_DIR = join(ROOT, "sagas");
const ALLOWED_STAGE_KEYS = new Set(["id", "title", "prompt", "requires", "produces", "success_criteria"]);
const ALLOWED_SAGA_KEYS = new Set(["id", "title", "version", "principle", "stages", "_path"]);
function now() { return new Date().toISOString(); }
function usage(exitCode = 0) {
    console.log(`ocx saga — staged prompt executor\n\nUsage:\n  ocx saga start <saga-name-or-path> [--run-id ID] [--force-new]\n  ocx saga submit <run-id> [--file answer.md] [--artifact file]\n  ocx saga current <run-id>\n  ocx saga status <run-id>\n  ocx saga list [--limit N]\n  ocx saga sagas\n  ocx saga validate [saga-name-or-path]\n  ocx saga show <saga-name-or-path> [--redact-prompts]\n  ocx saga export <run-id> [--format markdown|json] [--output file]\n  ocx saga abandon <run-id> [--reason text] [--force]\n\nRoot: ${ROOT}\nRuns: ${RUN_DIR}`);
    process.exit(exitCode);
}
function slugify(s) { return s.trim().toLowerCase().replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "") || "saga"; }
function sha256Text(text) { return createHash("sha256").update(text).digest("hex"); }
function sha256File(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function rel(path) { return relative(ROOT, path) || "."; }
function statePath(runId) { return join(RUN_DIR, `${runId}.json`); }
function asRecord(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`Invalid saga ${label}: expected object`);
    return value;
}
function requireString(value, label) {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`Invalid saga: ${label} must be a non-empty string`);
    return value;
}
function requireStringList(value, label) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || !value.every((x) => typeof x === "string" && x.trim())) {
        throw new Error(`Invalid saga: ${label} must be a list of non-empty strings`);
    }
    return value;
}
function validateSaga(data, source = "<memory>") {
    const obj = asRecord(data, source);
    const id = requireString(obj.id, "id");
    if (slugify(id) !== id)
        throw new Error(`Invalid saga ${source}: id must already be a lowercase slug`);
    if (!Array.isArray(obj.stages) || obj.stages.length === 0)
        throw new Error(`Invalid saga ${source}: requires non-empty stages`);
    for (const key of Object.keys(obj))
        if (!ALLOWED_SAGA_KEYS.has(key))
            throw new Error(`Invalid saga ${id}: unknown top-level key: ${key}`);
    const seen = new Set();
    const stages = obj.stages.map((raw, i) => {
        const stObj = asRecord(raw, `stage #${i + 1}`);
        for (const key of Object.keys(stObj))
            if (!ALLOWED_STAGE_KEYS.has(key))
                throw new Error(`Invalid saga ${id} stage #${i + 1}: unknown key: ${key}`);
        const stId = requireString(stObj.id, `stage #${i + 1}.id`);
        if (slugify(stId) !== stId)
            throw new Error(`Invalid saga ${id} stage #${i + 1}: id must already be a lowercase slug`);
        if (seen.has(stId))
            throw new Error(`Invalid saga ${id}: duplicate stage id: ${stId}`);
        seen.add(stId);
        return {
            id: stId,
            title: typeof stObj.title === "string" ? stObj.title : undefined,
            prompt: requireString(stObj.prompt, `stage ${stId}.prompt`),
            requires: requireStringList(stObj.requires, `stage ${stId}.requires`),
            produces: requireStringList(stObj.produces, `stage ${stId}.produces`),
            success_criteria: requireStringList(stObj.success_criteria, `stage ${stId}.success_criteria`),
        };
    });
    return { id, title: typeof obj.title === "string" ? obj.title : undefined, version: typeof obj.version === "string" ? obj.version : undefined, principle: typeof obj.principle === "string" ? obj.principle : undefined, stages, _path: typeof obj._path === "string" ? obj._path : undefined };
}
function loadSaga(pathOrName) {
    let p = pathOrName;
    if (!existsSync(p))
        p = join(SAGA_DIR, `${pathOrName}.json`);
    if (!existsSync(p))
        throw new Error(`Saga not found: ${pathOrName}`);
    const saga = validateSaga(JSON.parse(readFileSync(p, "utf-8")), p);
    saga._path = resolve(p);
    return saga;
}
function loadState(runId) {
    const p = statePath(runId);
    if (!existsSync(p))
        throw new Error(`Run not found: ${runId}`);
    return JSON.parse(readFileSync(p, "utf-8"));
}
function saveState(state) {
    mkdirSync(RUN_DIR, { recursive: true });
    const dest = statePath(state.run_id);
    const tmp = join(RUN_DIR, `.tmp-${process.pid}-${Date.now()}.json`);
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(tmp, dest);
}
function runningStatesForSaga(sagaId) {
    mkdirSync(RUN_DIR, { recursive: true });
    return readdirSync(RUN_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
        try {
            return JSON.parse(readFileSync(join(RUN_DIR, f), "utf-8"));
        }
        catch {
            return undefined;
        }
    })
        .filter((s) => !!s && s.saga_id === sagaId && s.status === "running" && !s.run_id.startsWith("test-"))
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}
function formatContract(st) {
    const parts = [];
    for (const [key, label] of [["requires", "Requires"], ["produces", "Produces"], ["success_criteria", "Success criteria"]]) {
        const values = st[key] || [];
        if (values.length)
            parts.push(`\n${label}:`, ...values.map((v) => `- ${v}`));
    }
    return parts.join("\n");
}
function priorSubmissionsBlock(state) {
    if (!state.submissions.length)
        return "";
    return `\nPrior submitted stages:\n${state.submissions.map((s) => `- ${s.stage_id} -> ${s.answer_path} sha256=${s.sha256.slice(0, 12)} chars=${s.chars}`).join("\n")}\n`;
}
function stagePrompt(saga, idx, state) {
    const st = saga.stages[idx];
    const title = st.title ? ` — ${st.title}` : "";
    return `# ocx saga stage ${idx + 1}/${saga.stages.length}: ${st.id}${title}\nSaga: ${saga.id} — ${saga.title || ""}\nRun ID: ${state.run_id}\n${formatContract(st)}\n\n${st.prompt.trimEnd()}\n${priorSubmissionsBlock(state)}\nWhen complete, submit with:\nocx saga submit ${state.run_id} --file <answer.md>\n`;
}
function readStdin() {
    return new Promise((resolveValue) => {
        let data = "";
        process.stdin.setEncoding("utf-8");
        process.stdin.on("data", (chunk) => { data += chunk; });
        process.stdin.on("end", () => resolveValue(data));
    });
}
function getFlag(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }
function hasFlag(args, name) { return args.includes(name); }
function removeFlagPair(args, name) { const i = args.indexOf(name); if (i >= 0)
    args.splice(i, 2); }
function copyArtifacts(runId, paths) {
    const out = [];
    if (!paths.length)
        return out;
    const artifactDir = join(RUN_DIR, runId, "artifacts");
    mkdirSync(artifactDir, { recursive: true });
    for (const raw of paths) {
        const src = resolve(raw);
        if (!existsSync(src) || !statSync(src).isFile())
            throw new Error(`Artifact is not a readable file: ${raw}`);
        let dest = join(artifactDir, basename(src));
        if (existsSync(dest))
            dest = join(artifactDir, `${basename(src).replace(/(\.[^.]+)?$/, `-${Date.now()}$1`)}`);
        copyFileSync(src, dest);
        out.push({ source: raw, path: rel(dest), sha256: sha256File(dest), bytes: statSync(dest).size });
    }
    return out;
}
async function cmdStart(args) {
    const sagaName = args[0];
    if (!sagaName)
        usage(1);
    const runIdFlag = getFlag(args, "--run-id");
    const forceNew = hasFlag(args, "--force-new");
    const saga = loadSaga(sagaName);
    if (!forceNew && !runIdFlag) {
        const running = runningStatesForSaga(saga.id);
        if (running.length) {
            const state = running[0];
            const snapshot = loadSaga(join(ROOT, state.saga_snapshot_path));
            console.log(`# Resuming existing running saga: ${state.run_id}\n`);
            console.log(stagePrompt(snapshot, state.current_stage_index, state));
            return;
        }
    }
    const runId = runIdFlag || `${slugify(saga.id)}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${Math.random().toString(16).slice(2, 8)}`;
    if (existsSync(statePath(runId)))
        throw new Error(`Run already exists: ${runId}`);
    const runDir = join(RUN_DIR, runId);
    mkdirSync(runDir, { recursive: false });
    const sagaText = readFileSync(saga._path, "utf-8");
    const snapshotPath = join(runDir, "saga.json");
    writeFileSync(snapshotPath, sagaText);
    const state = {
        run_id: runId,
        saga_id: saga.id,
        saga_version: saga.version,
        saga_path: saga._path,
        saga_snapshot_path: rel(snapshotPath),
        saga_sha256: sha256Text(sagaText),
        created_at: now(),
        current_stage_index: 0,
        status: "running",
        submissions: [],
        notes: [],
    };
    saveState(state);
    console.log(stagePrompt(saga, 0, state));
}
async function cmdSubmit(args) {
    const runId = args[0];
    if (!runId)
        usage(1);
    const state = loadState(runId);
    if (state.status !== "running")
        throw new Error(`Run is not running: ${state.status}`);
    const saga = loadSaga(join(ROOT, state.saga_snapshot_path));
    const idx = state.current_stage_index;
    if (idx >= saga.stages.length)
        throw new Error("No current stage; saga already complete");
    const file = getFlag(args, "--file");
    const artifactPaths = args.flatMap((v, i) => v === "--artifact" && args[i + 1] ? [args[i + 1]] : []);
    const answer = (file ? readFileSync(file, "utf-8") : await readStdin()).trim();
    if (!answer)
        throw new Error("Empty answer rejected");
    const st = saga.stages[idx];
    const outDir = join(RUN_DIR, runId);
    mkdirSync(outDir, { recursive: true });
    const answerPath = join(outDir, `${String(idx + 1).padStart(2, "0")}-${st.id}.md`);
    writeFileSync(answerPath, `${answer}\n`);
    state.submissions.push({
        stage_index: idx,
        stage_id: st.id,
        stage_title: st.title,
        submitted_at: now(),
        answer_path: rel(answerPath),
        sha256: sha256Text(answer),
        chars: answer.length,
        artifacts: copyArtifacts(runId, artifactPaths),
    });
    const nextIdx = idx + 1;
    if (nextIdx >= saga.stages.length) {
        state.current_stage_index = nextIdx;
        state.status = "complete";
        state.completed_at = now();
        saveState(state);
        console.log(`✅ Saga complete: ${runId}`);
        console.log(`Submissions: ${state.submissions.length}`);
        console.log(`Export transcript: ocx saga export ${runId} --format markdown`);
        return;
    }
    state.current_stage_index = nextIdx;
    saveState(state);
    console.log(stagePrompt(saga, nextIdx, state));
}
function cmdCurrent(args) {
    const state = loadState(args[0] || "");
    if (state.status !== "running") {
        console.log(`Saga is ${state.status}`);
        return;
    }
    const saga = loadSaga(join(ROOT, state.saga_snapshot_path));
    console.log(stagePrompt(saga, state.current_stage_index, state));
}
function cmdStatus(args) {
    const state = loadState(args[0] || "");
    const saga = loadSaga(join(ROOT, state.saga_snapshot_path));
    const idx = state.current_stage_index;
    console.log(`Run: ${state.run_id}`);
    console.log(`Saga: ${state.saga_id} v${state.saga_version || saga.version || "unknown"}`);
    console.log(`Status: ${state.status}`);
    console.log(`Stage: ${Math.min(idx + 1, saga.stages.length)}/${saga.stages.length}`);
    if (state.status === "running") {
        const cur = saga.stages[idx];
        console.log(`Current: ${cur.id} — ${cur.title || ""}`);
        console.log(`Prompt: ocx saga current ${state.run_id}`);
    }
    for (const sub of state.submissions) {
        console.log(`- submitted ${sub.stage_id} -> ${sub.answer_path} (${sub.chars} chars, sha256=${sub.sha256.slice(0, 12)})`);
        for (const art of sub.artifacts)
            console.log(`  artifact ${art.path} (${art.bytes} bytes, sha256=${art.sha256.slice(0, 12)})`);
    }
}
function cmdList(args) {
    mkdirSync(RUN_DIR, { recursive: true });
    const limit = Number(getFlag(args, "--limit") || "20");
    for (const f of readdirSync(RUN_DIR).filter((name) => name.endsWith(".json")).map((name) => join(RUN_DIR, name)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, limit)) {
        const s = JSON.parse(readFileSync(f, "utf-8"));
        console.log(`${s.run_id}  ${s.status}  ${s.saga_id}  stage=${s.current_stage_index}`);
    }
}
function cmdSagas() {
    mkdirSync(SAGA_DIR, { recursive: true });
    for (const f of readdirSync(SAGA_DIR).filter((name) => name.endsWith(".json")).sort()) {
        const saga = loadSaga(join(SAGA_DIR, f));
        console.log(`${saga.id}  v${saga.version || "?"}  stages=${saga.stages.length}  ${saga.title || ""}`);
    }
}
function cmdValidate(args) {
    const target = args[0];
    const targets = target ? [target] : readdirSync(SAGA_DIR).filter((f) => f.endsWith(".json")).map((f) => join(SAGA_DIR, f));
    if (!targets.length)
        throw new Error("No sagas found");
    for (const t of targets) {
        const saga = loadSaga(t);
        console.log(`✅ ${saga.id} valid (${saga.stages.length} stages)`);
    }
}
function cmdShow(args) {
    const sagaName = args[0];
    if (!sagaName)
        usage(1);
    const saga = loadSaga(sagaName);
    console.log(`Saga: ${saga.id} v${saga.version || "?"} — ${saga.title || ""}`);
    if (saga.principle)
        console.log(`Principle: ${saga.principle}`);
    for (let i = 0; i < saga.stages.length; i++) {
        const st = saga.stages[i];
        console.log(`\n${i + 1}. ${st.id} — ${st.title || ""}`);
        console.log(formatContract(st).trim());
        console.log(hasFlag(args, "--redact-prompts") ? "[redacted]" : st.prompt.trim());
    }
}
function exportText(state, fmt) {
    if (fmt === "json")
        return `${JSON.stringify(state, null, 2)}\n`;
    const saga = loadSaga(join(ROOT, state.saga_snapshot_path));
    const lines = [`# ocx saga transcript: ${state.run_id}`, "", `- Saga: ${state.saga_id} v${state.saga_version || saga.version || "unknown"}`, `- Status: ${state.status}`, `- Created: ${state.created_at}`];
    if (state.completed_at)
        lines.push(`- Completed: ${state.completed_at}`);
    for (const sub of state.submissions) {
        lines.push("", `## Stage ${sub.stage_index + 1}: ${sub.stage_id}`, "", `- Submitted: ${sub.submitted_at}`, `- SHA256: \`${sub.sha256}\``);
        for (const art of sub.artifacts)
            lines.push(`- Artifact: \`${art.path}\` sha256=\`${art.sha256}\``);
        lines.push("", readFileSync(join(ROOT, sub.answer_path), "utf-8").trimEnd());
    }
    return `${lines.join("\n")}\n`;
}
function cmdExport(args) {
    const state = loadState(args[0] || "");
    const fmt = getFlag(args, "--format") || "markdown";
    if (!["markdown", "json"].includes(fmt))
        throw new Error("--format must be markdown or json");
    const output = exportText(state, fmt);
    const outPath = getFlag(args, "--output");
    if (outPath) {
        mkdirSync(dirname(resolve(outPath)), { recursive: true });
        writeFileSync(outPath, output);
        console.log(`exported ${fmt} transcript -> ${outPath}`);
    }
    else
        process.stdout.write(output);
}
function cmdAbandon(args) {
    const state = loadState(args[0] || "");
    if (state.status !== "running" && !hasFlag(args, "--force"))
        throw new Error(`Run is not running: ${state.status}. Use --force to mark anyway.`);
    const reason = getFlag(args, "--reason");
    state.status = "abandoned";
    state.abandoned_at = now();
    if (reason)
        state.notes.push({ at: now(), kind: "abandon_reason", text: reason });
    saveState(state);
    console.log(`abandoned ${state.run_id}`);
}
async function main() {
    const args = process.argv.slice(2);
    const cmd = args.shift();
    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h")
        usage(0);
    try {
        if (cmd === "start")
            await cmdStart(args);
        else if (cmd === "submit")
            await cmdSubmit(args);
        else if (cmd === "current")
            cmdCurrent(args);
        else if (cmd === "status")
            cmdStatus(args);
        else if (cmd === "list")
            cmdList(args);
        else if (cmd === "sagas")
            cmdSagas();
        else if (cmd === "validate")
            cmdValidate(args);
        else if (cmd === "show")
            cmdShow(args);
        else if (cmd === "export")
            cmdExport(args);
        else if (cmd === "abandon")
            cmdAbandon(args);
        else
            throw new Error(`Unknown saga command: ${cmd}`);
    }
    catch (err) {
        console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}
void main();
//# sourceMappingURL=saga.js.map