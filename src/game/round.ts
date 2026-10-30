/** Tunable rules of a Hole. */
export type RoundSettings = {
  par: number;
  /** The Hole is won once the Target's Height is below this fraction of its starting Height. */
  winBelow: number;
  /** Seconds a Shot may run before the scene counts as Settled anyway. */
  settleTimeout: number;
};

export const DEFAULT_ROUND: RoundSettings = { par: 5, winBelow: 0.3, settleTimeout: 10 };

export type RoundState = "aiming" | "shot" | "won";

/**
 * One play of a Hole: counts Strokes and decides, each time the scene
 * Settles, whether the Target is down. `startHeight` is the Target's Height
 * before the first Shot.
 */
export function createRound(settings: RoundSettings, startHeight: number) {
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
    /** The Height the Target must fall below to win. */
    get winHeight() {
      return startHeight * settings.winBelow;
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

    /** Ends the Shot with the Target at `height`: the Hole is won, or the next Shot may be aimed. */
    finish(height: number) {
      if (state !== "shot") return;
      state = height < this.winHeight ? "won" : "aiming";
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
