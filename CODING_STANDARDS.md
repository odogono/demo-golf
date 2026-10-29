# Coding standards

Rules for review. Mechanical rules belong in `bun run typecheck`, tests or `tools/commits/check.ts`, not here.

- **Docs stay true.** When a diff changes behaviour that `NOTES.md`, `README.md`'s code map, `docs/physics-api.md` or `GLOSSARY.md` describes, the same diff updates or deletes those lines. Flag lines written as history ("until M5", "for now", "placeholder") that the diff makes untrue.
- **New Crashcat or `math` knowledge goes in `docs/physics-api.md`.** A diff that starts using a Crashcat call or `math` entry point not listed there adds it, with any gotcha found on the way.
- **Debug hooks are permanent and named.** Scripted access to the game goes through `window.__golf` in `src/main.ts`; flag temporary hooks (`TEMP`, ad hoc `window.*` globals) left in a diff.
