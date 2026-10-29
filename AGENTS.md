# AGENTS.md

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `odogono/demo-golf` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Commits and the changelog

PR titles follow Conventional Commits. `feat`, `fix`, `perf` and breaking changes add a changelog fragment under `changelog/unreleased/` instead of editing a changelog; releases are written to `releases/changelog/`. Before writing a PR title or releasing, read `docs/agents/commits.md`.
