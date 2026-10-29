# Crashcat issues

Bugs and limits found in Crashcat, the physics engine, with how we work around each one. Everything is checked against the pinned commit `github:isaac-mason/crashcat#e3dcec1`. Day-to-day usage notes stay in [`NOTES.md`](../NOTES.md).

When you bump the pin, recheck every open issue below and update its status.

Each entry records:

- **Status:** open, reported, fixed upstream or worked around.
- **Found:** the date and the pinned commit.
- **Symptom:** what we saw.
- **Cause:** where it comes from in Crashcat's source.
- **Repro:** the smallest case that shows it.
- **Workaround:** what we do instead, and where.
- **Upstream:** the issue or PR, if one exists.
- **Remove when:** what lets us delete the workaround.

## 1. CCD contacts report a reversed normal

- **Status:** worked around, not yet reported.
- **Found:** 2026-10-29, at `e3dcec1`, during M1 (#7).
- **Symptom:** for contacts from the CCD pass (`MotionQuality.LINEAR_CAST`), `onContactAdded` gets `manifold.worldSpaceNormal` pointing from B to A. Discrete contacts point from A to B. `estimateCollisionResponse` then reads the bodies as moving apart and returns an impulse of 0, so every fast ball hit would deal no damage.
- **Cause:** in `src/update.ts`, `findCCDContacts` copies `ccdBody.contactNormal` straight into the contact manifold. That normal points from B to A, because the CCD response in `applyCCD` uses it that way. `onCCDContactAdded` then swaps the bodies and negates the normal correctly, but the normal was already reversed before the swap.
- **Repro:** with zero gravity, put a static box with half-extents `[0.1, 5, 5]` at `x = 5`, and a dynamic sphere with radius 0.05 at the origin, moving at `[60, 0, 0]`. Log `onContactAdded`. With `LINEAR_CAST`, the normal is `[1, 0, 0]` and the estimated impulse is 0. With `DISCRETE`, it's `[-1, 0, 0]` with an impulse of about 31.
- **Workaround:** `hasReversedCcdNormal` in `src/physics/crashcat/createCrashcatWorld.ts`. If a newly added contact involves a dynamic CCD body and the bodies are moving apart along the normal, we estimate the impulse on a copy of the manifold with the normal negated. After this, CCD and discrete contacts give the same impulse, about 31 at 60 m/s. `test/physics/crashcat.test.ts` checks both the impulse and the normal's direction.
- **Risk:** if a new contact on a CCD body really is moving apart, its normal gets flipped wrongly, and a non-zero impulse may be estimated. We haven't seen this happen.
- **Proposed fix:** negate the normal where `findCCDContacts` writes it into the manifold, so it points from A to B like discrete contacts. The CCD response keeps using `ccdBody.contactNormal` as it is.
- **Upstream:** none yet.
- **Remove when:** the pin includes the fix. The workaround then never triggers, so remove it once the test passes without it.

## Not bugs, but limits we work around

- **No contact impulse is reported.** Listeners run before the solver, so `ContactEvent.impulse` is an estimate from `estimateCollisionResponse`, not the impulse the solver actually applied. See `NOTES.md`.
