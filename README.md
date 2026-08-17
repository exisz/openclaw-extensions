# OpenClaw Extensions (`ocx`)

CLI utilities for [OpenClaw](https://github.com/nicepkg/openclaw) — cron frequency management, adaptive scheduling, and operational tools.

## Use without installing
```
npx openclaw-extensions doctor
```

## Install

```bash
npm install -g openclaw-extensions
```

To load the OpenClaw prompt-injection plugin as well:

```bash
npm run build
openclaw plugins install .
openclaw gateway restart
```

The CLI can be installed without enabling the plugin.

## Usage

```bash
# Increase cron frequency one tier (shorter interval)
ocx cron up <cron_id> [--step N]

# Decrease cron frequency one tier (longer interval)
ocx cron down <cron_id> [--step N]

# Sync linked cron frequency (follower = source × multiplier)
ocx cron link <follower_id> <source_id> <multiplier>

# Diagnose model call failures for an agent or channel session
ocx model-debug --agent <id>
ocx model-debug --agent <id> --channel <discord_channel_id>
ocx model-debug --agent <id> --last <n>   # default: 5
ocx model-debug --session <trajectory-file-path-or-id-fragment>

# Quickly compare the subagent policy with models currently exposed by OpenClaw
ocx model check
ocx model check --format json

# Validate OpenClaw config — catch bad model refs before they fail at runtime
ocx doctor
ocx doctor --fix   # auto-remove invalid per-agent model overrides

# Merge all $include files into openclaw.json (with an automatic backup)
ocx config merge [--config ~/.openclaw/openclaw.json] [--dry-run]

# Split agents and bindings back into agents.json5 / bindings.json5
ocx config split [--config ~/.openclaw/openclaw.json] [--dry-run]
```

### `ocx model-debug`

Inspects trajectory files and gateway logs to surface the root cause when an agent silently fails or falls back unexpectedly. Useful when a model switch (e.g. via Discord model picker) breaks an agent and there is no visible error.

Checks:
- `stopReason: error` + `errorMessage` in trajectory `messagesSnapshot`
- Zero-token calls (model fired but produced nothing)
- Fallback activations
- Discord model-picker selection history
- `gateway.err.log` snippets around the failure time

If no trajectory is found for the given channel, falls back to scanning `gateway.err.log` to identify which agent owns that channel.

### `ocx doctor`

Validates model references in `openclaw.json` that `openclaw doctor` does not check (see [openclaw/openclaw#39811](https://github.com/openclaw/openclaw/issues/39811)):

- Per-agent `model` overrides are known model IDs (present in `agents.defaults.models`)
- Bare `"default"` strings — these resolve to `openai/default` which does not exist and will always fail at runtime
- Primary model and all fallbacks in `agents.defaults.model`

`--fix` automatically removes invalid per-agent `model` fields so they inherit the global default.

## OpenClaw Plugin

The plugin registers a `before_prompt_build` hook and appends matching prompt
injections inside an `<ocx>` system-context block.

Injection files use Markdown frontmatter:

```markdown
---
id: operational-policy
trigger: interactive
---

Add the operational guidance here.
```

Supported triggers are `always`, `interactive`, `cron`, and `subagent`.
Later directories override earlier files with the same `id`:

1. Package defaults: `injections/`
2. Legacy user overrides: `~/.openclaw/ocx/injections/`
3. Current user overrides: `~/.openclaw/.ocx/injections/`

## Frequency Tiers

`cron up` and `cron down` move through these tiers:

| Tier | Interval |
|------|----------|
| 0    | 168h     |
| 1    | 72h      |
| 2    | 48h      |
| 3    | 24h      |
| 4    | 12h      |
| 5    | 8h       |
| 6    | 6h       |
| 7    | 4h       |
| 8    | 3h       |
| 9    | 2h       |
| 10   | 1h       |

## Safety

- Only adjusts crons with `[ADAPTIVE]` (or `[LINKED]`) in their name
- Only works with `"every"` schedule kind (not cron expressions)
- `anchorMs` is never modified
- Linked cron results are clamped to 1h–168h range

## Requirements

- Node.js >= 18
- OpenClaw CLI (`openclaw cron edit` must be available)

## License

Apache-2.0
