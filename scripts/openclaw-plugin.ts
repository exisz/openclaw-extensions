import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureOcxWorkspace, OCX_INJECTIONS_DIR } from "./workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const HOME = process.env.HOME || "";

type InjectionTrigger = "always" | "interactive" | "cron" | "subagent";
type Injection = { id: string; trigger: string; content: string };

function parseFrontmatter(file: string, raw: string): Injection | null {
  if (!raw.startsWith("---")) return { id: file.replace(/\.md$/, ""), trigger: "always", content: raw.trim() };
  const end = raw.indexOf("---", 3);
  if (end === -1) return null;
  const fmText = raw.slice(3, end).trim();
  const body = raw.slice(end + 3).trim();
  const meta: Record<string, string> = {};
  for (const line of fmText.split("\n")) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { id: meta.id || file.replace(/\.md$/, ""), trigger: meta.trigger || "always", content: body };
}

function loadInjections(): Injection[] {
  ensureOcxWorkspace();
  const dirs = [join(PACKAGE_ROOT, "injections"), join(HOME, ".openclaw/ocx/injections"), OCX_INJECTIONS_DIR];
  const seen = new Set<string>();
  const out: Injection[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((name) => name.endsWith(".md")).sort()) {
      const parsed = parseFrontmatter(f, readFileSync(join(dir, f), "utf-8"));
      if (!parsed) continue;
      if (seen.has(parsed.id)) {
        const idx = out.findIndex((inj) => inj.id === parsed.id);
        if (idx >= 0) out.splice(idx, 1);
      }
      seen.add(parsed.id);
      out.push(parsed);
    }
  }
  return out;
}

function classifyTrigger(ctx: any): InjectionTrigger {
  if (ctx?.trigger === "cron") return "cron";
  const sessionKey = typeof ctx?.sessionKey === "string" ? ctx.sessionKey : "";
  if (sessionKey.includes(":subagent:")) return "subagent";
  return "interactive";
}

function getInjectionText(trigger: InjectionTrigger): string {
  const parts = loadInjections()
    .filter((inj) => inj.trigger === "always" || inj.trigger === trigger)
    .map((inj) => inj.content);
  if (!parts.length) return "";
  return `<ocx>\n${parts.join("\n\n")}\n</ocx>`;
}

const plugin = {
  id: "openclaw-extensions",
  name: "OpenClaw Extensions",
  description: "OpenClaw-specific global prompt injections and operational helpers.",
  configSchema: { parse: () => ({}) },
  register(api: any) {
    api.on(
      "before_prompt_build",
      (_event: unknown, ctx: any) => {
        const injectable = getInjectionText(classifyTrigger(ctx));
        return injectable ? { appendSystemContext: injectable } : {};
      },
      { priority: 6 },
    );
    ensureOcxWorkspace();
    api.logger?.info?.("openclaw-extensions: registered (workspace prompt injections)");
  },
};

export default plugin;
