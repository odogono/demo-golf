/** Tunable rules of a Hole. */
export type RoundSettings = {
  par: number;
  /** The Hole is won once this share of the Target's starting Cells is Destroyed (ADR 0004). */
  winDestroyed: number;
  /** Seconds a Shot may run before the scene counts as Settled anyway. */
  settleTimeout: number;
};

export const DEFAULT_ROUND: RoundSettings = { par: 5, winDestroyed: 0.7, settleTimeout: 10 };

export type RoundState = "aiming" | "shot" | "won";

/**
 * One play of a Hole: counts Strokes and decides, each time the scene
 * Settles, whether the Target is down. `startCells` is how many Cells the
 * Target's Structure held before the first Shot.
 */
export function createRound(settings: RoundSettings, startCells: number) {
  let state: RoundState = "aiming";
  let strokes = 0;
  let time = 0;

  return {
    settings,
    get state() {
      return state;
    },
    get strokes() {
      return strokes;
    },
    /** The share of the Target Destroyed, 0 to 1, when `cells` remain in its Structure. */
    destroyed(cells: number): number {
      return startCells === 0 ? 0 : 1 - cells / startCells;
    },

    /** Takes a Shot if one is allowed now. Returns whether it was. */
    shoot(): boolean {
      if (state !== "aiming") return false;
      state = "shot";
      strokes++;
      time = 0;
      return true;
    },

    /**
     * Advances a Shot in play. `settled` says whether every body is at rest.
     * Returns true when the Shot is over because it Settled or timed out;
     * `timedOut` tells which, so the caller can freeze what still moves.
     */
    update(dt: number, settled: boolean): { over: boolean; timedOut: boolean } {
      if (state !== "shot") return { over: false, timedOut: false };
      time += dt;
      const timedOut = !settled && time >= settings.settleTimeout;
      return { over: settled || timedOut, timedOut };
    },

    /**
     * Ends the Shot with `cells` left in the Target's Structure: the Hole is
     * won, or the next Shot may be aimed. Cells that left it as Rubble count
     * as Destroyed, even if they landed upright.
     */
    finish(cells: number) {
      if (state !== "shot") return;
      state = this.destroyed(cells) >= settings.winDestroyed ? "won" : "aiming";
    },
  };
}

export type Round = ReturnType<typeof createRound>;

/** How a score reads against Par, in golf's words where it has them. */
export function scoreName(strokes: number, par: number): string {
  const diff = strokes - par;
  if (strokes === 1) return "Hole in one";
  const names: Record<number, string> = { [-3]: "Albatross", [-2]: "Eagle", [-1]: "Birdie", 0: "Par", 1: "Bogey", 2: "Double bogey" };
  return names[diff] ?? (diff < 0 ? `${-diff} under par` : `${diff} over par`);
}
