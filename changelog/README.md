# Changelog fragments

Each PR whose title is `feat`, `fix` or `perf`, or marks a breaking change, adds one fragment to `unreleased/`. Name it `<issue>-<slug>.md`, such as `10-putting-green.md`, so fragments sort by issue and never collide:

```md
---
type: feat
scope: game
section: added
---

**Putts break with the slope of the green.** Read the contours before you
strike the ball (#10).
```

- `type` is `feat`, `fix` or `perf`, the same as the PR title's. A breaking `refactor!` or similar uses the closest of the three.
- `scope` is the PR title's scope. Leave it out when the title has none.
- `section` is the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) section the entry goes under:
  - `feat`: `added`, `changed` or `removed`.
  - `fix`: `fixed`.
  - `perf`: `changed`.
  - `known`: an outstanding problem, with any type, `docs` included. A PR may add one beside its entry or on its own, but it never counts as the entry a `feat`, `fix` or `perf` title needs.
- `breaking: true` marks a breaking change.

The text after the frontmatter is the entry, written for someone playing the game: a bold headline sentence saying what changed for them, then as much as they need, ending with the issue.

`bun run changelog` prints every fragment as one `## [Unreleased]` section. `bun run changelog:release X.Y.Z` writes them into [`releases/changelog/X.Y.Z.md`](../releases/changelog/), rebuilds that directory's index, deletes the fragments and sets `package.json`'s version; tag `vX.Y.Z` by hand once the release PR merges. [The commit conventions](../docs/agents/commits.md) describe when a fragment is needed.
