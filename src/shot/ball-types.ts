/**
 * Ball types are data: a Shot looks its ball up here by id. Explosive balls
 * carry a Blast, set off on their first contact (`damage/damage.ts`).
 */
export type BallType = {
  id: string;
  name: string;
  /** Metres. Larger than a real golf ball so it reads at Hole scale. */
  radius: number;
  /** kg. */
  mass: number;
  restitution: number;
  friction: number;
  /** Air drag as linear damping: the fraction of velocity lost per second. */
  drag: number;
  /** Launch speed at full power, in m/s. */
  maxSpeed: number;
  /** sRGB hex, for rendering. */
  colour: number;
  /** The Blast the ball sets off on impact, if any. */
  blast?: { radius: number; power: number };
};

export const BALL_TYPES = {
  standard: {
    id: "standard",
    name: "Standard",
    radius: 0.15,
    mass: 1,
    restitution: 0.5,
    friction: 0.5,
    drag: 0.05,
    maxSpeed: 40,
    colour: 0xf4f4f0,
  },
  explosive: {
    id: "explosive",
    name: "Explosive",
    radius: 0.2,
    mass: 2,
    restitution: 0.2,
    friction: 0.6,
    drag: 0.08,
    maxSpeed: 32,
    colour: 0xd8402a,
    blast: { radius: 3, power: 150 },
  },
} satisfies Record<string, BallType>;

export type BallTypeId = keyof typeof BALL_TYPES;
