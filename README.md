# OpenClaw Extensions (`ocx`)

CLI utilities for [OpenClaw](https://github.com/nicepkg/openclaw) — cron frequency management, adaptive scheduling, and operational tools.

## Install

```bash
npm install -g openclaw-extensions
```

## Usage

```bash
# Increase cron frequency one tier (shorter interval)
ocx cron up <cron_id> [--step N]

# Decrease cron frequency one tier (longer interval)
ocx cron down <cron_id> [--step N]

# Sync linked cron frequency (follower = source × multiplier)
ocx cron link <follower_id> <source_id> <multiplier>
```

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
