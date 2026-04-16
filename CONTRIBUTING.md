# Contributing to OpenClaw Extensions

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/exisz/openclaw-extensions.git
cd openclaw-extensions
npm link
```

No build step needed — scripts run directly via `node --experimental-strip-types`.

## Making Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Test locally: `ocx cron --help`
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
6. Open a Pull Request

## Commit Convention

We use Conventional Commits:

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation changes
- `chore:` — maintenance tasks
- `refactor:` — code restructuring

## Reporting Issues

Use GitHub Issues. Include steps to reproduce, expected behavior, and actual behavior.
