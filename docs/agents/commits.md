# Commits and the changelog

PRs are squash-merged, so a PR's title becomes the commit on `main`. CI checks every PR title and requires a changelog fragment for the changes a player would want to hear about. A `commit-msg` hook checks local commits' format; `bun install` turns it on.

## Subject format

```text
type(scope)!: Sentence-case imperative description (#issue)
```

- **type**, one of:
  - `feat`: a new or changed behaviour a player would notice.
  - `fix`: a behaviour that was wrong.
  - `perf`: the same behaviour, faster or smaller.
  - `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`: no change a player would notice.

  Pick the type from what the diff does, not from the branch name or the issue's wording: a `fix/issue-141` branch that adds a behaviour the game never had is `feat`.

- **scope**, optional, one of:
  - `game`: gameplay, physics and rules.
  - `ui`: rendering, input and menus.
  - `tools`: the asset pipeline and repo tooling, `tools/`.
  - `docs`: documentation, the glossary and ADRs.
  - `repo`: CI, hooks and workspace setup.

  The list lives in `SCOPES` in `tools/commits/message.ts`; change it there and here together.

- **!**, before the colon, marks a breaking change. A `BREAKING CHANGE: ...` line in the PR body does too.
- The description starts with a capital letter and doesn't end with a full stop. It may end with the issue it closes, as `(#10)`, or the ADR it records, as `(ADR 0004)`.

Examples:

```text
feat(game): Break putts with the slope of the green (#10)
fix(ui): Keep the aim line on screen at the course's edge (#8)
ci(repo): Enforce Conventional Commit titles and changelog fragments
```

The hook lets through `fixup!`, `squash!` and `amend!` commits, and the merge and revert commits git writes itself.

## When a changelog fragment is needed

A PR whose title is `feat`, `fix` or `perf`, or marks a breaking change, adds a fragment under `changelog/unreleased/` whose type and scope match the title. [The fragment format](../../changelog/README.md) describes the file. There is no way to skip this: a change with nothing worth recording has the wrong type, so retitle it.

## Releasing

Versions are semver, `0.x.y` until the game is complete. To release:

1. On a branch, run `bun run changelog:release 0.1.0`. It writes `releases/changelog/0.1.0.md`, updates the index, deletes the fragments and bumps `package.json`.
2. Merge it as `chore(repo): Release 0.1.0`.
3. Tag the merge commit on `main`: `git tag v0.1.0 && git push origin v0.1.0`.

## Checking locally

Write the changelog fragment before running this: the check fails a `feat`, `fix` or `perf` title without one. To check a PR the way CI does, run:

```sh
PR_TITLE="feat(game): Add x" BASE_REF=main bun tools/commits/check.ts pr
```
