import { describe, expect, it } from 'vitest';
import {
  DEATH_CAUSE_STARVATION,
  EMERGENCY_CONVERSION_BIOMASS,
  EMERGENCY_CONVERSION_ENERGY,
  TICKS_PER_SECOND,
  convertCarriedBiomass,
  drainEnergyForTick,
  type EnergyTickResult,
  type EnergizedRobot,
} from './index';

// The milliwatt accumulator (D6) and the starvation chain (20 Phase 13).
// The 5 W regression is the T6 anchor: floor(5000/60) = 0 made sub-60 W
// parts free; here tick 1 of a 5 W draw is 83 milli-units, measurably.

interface RobotOverrides {
  readonly id?: string;
  readonly energyMaxMilli?: number;
  readonly energyMilli?: number;
  readonly energyRemainder?: number;
  readonly biomassCarried?: number;
  readonly alive?: boolean;
}

const makeRobot = (overrides: RobotOverrides = {}): EnergizedRobot => ({
  id: overrides.id ?? 'robot',
  energyMaxMilli: overrides.energyMaxMilli ?? 500000,
  energyMilli: overrides.energyMilli ?? 500000,
  energyRemainder: overrides.energyRemainder ?? 0,
  biomassCarried: overrides.biomassCarried ?? 0,
  alive: overrides.alive ?? true,
});

const runTicks = (robot: EnergizedRobot, netPowerMilliwatts: number, ticks: number): EnergyTickResult[] => {
  const results: EnergyTickResult[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    results.push(drainEnergyForTick(robot, netPowerMilliwatts));
  }
  return results;
};

describe('drainEnergyForTick — the milliwatt accumulator (D6)', () => {
  it('[normal] a 5 W draw costs 83 milli-units on tick 1, never 0 (the regression guard)', () => {
    const robot = makeRobot();
    const result = drainEnergyForTick(robot, 5000);
    expect(result.poolDeltaMilli).toBe(-83);
    expect(robot.energyMilli).toBe(500000 - 83);
    expect(robot.energyRemainder).toBe(20);
  });

  it('[normal] a net-zero chassis (Mk-1 engine + solar panel) holds energy steady', () => {
    const robot = makeRobot();
    runTicks(robot, 0, 100);
    expect(robot.energyMilli).toBe(500000);
    expect(robot.energyRemainder).toBe(0);
  });

  it('[normal] a reactor bot charges to the cap and stops there', () => {
    const robot = makeRobot({ energyMilli: 0 });
    runTicks(robot, -10000, 3000);
    expect(robot.energyMilli).toBe(500000);
    expect(robot.energyRemainder).toBe(0);
    runTicks(robot, -10000, 50);
    expect(robot.energyMilli).toBe(500000);
  });

  it('[boundary] the 5 W remainder pattern is 83, 83, 84 — the carry averages exactly', () => {
    const robot = makeRobot();
    const results = runTicks(robot, 5000, 3);
    expect(results.map((result) => -result.poolDeltaMilli)).toEqual([83, 83, 84]);
    expect(robot.energyMilli).toBe(500000 - 250);
  });

  it('[boundary] recharge floors: an empty pool gains 167 on the first reactor tick', () => {
    const robot = makeRobot({ energyMilli: 0 });
    const result = drainEnergyForTick(robot, -10000);
    expect(result.poolDeltaMilli).toBe(167);
    expect(robot.energyMilli).toBe(167);
    expect(robot.energyRemainder).toBe(20);
  });

  it('[boundary] an exactly-empty pool at 60 ticks of 5 W drain is exactly drained', () => {
    const robot = makeRobot({ energyMilli: 500000 });
    runTicks(robot, 5000, 6000);
    expect(robot.energyMilli).toBe(0);
  });

  it('[boundary] the pool clamps at the cap and discards the overproduction', () => {
    const robot = makeRobot({ energyMilli: 499990 });
    const result = drainEnergyForTick(robot, -10000);
    expect(robot.energyMilli).toBe(500000);
    expect(robot.energyRemainder).toBe(0);
    expect(result.poolDeltaMilli).toBe(167);
  });

  it('[invalid] fractional, NaN and beyond-bound power are caller or catalog bugs', () => {
    const robot = makeRobot();
    expect(() => drainEnergyForTick(robot, 5000.5)).toThrow(TypeError);
    expect(() => drainEnergyForTick(robot, Number.NaN)).toThrow(TypeError);
    expect(() => drainEnergyForTick(robot, 1000001)).toThrow(RangeError);
    expect(() => drainEnergyForTick(robot, -1000001)).toThrow(RangeError);
  });

  it('[invalid] corpses do not metabolise: no drain, no conversion, no death', () => {
    const robot = makeRobot({ alive: false, energyMilli: 0, biomassCarried: 10 });
    const result = drainEnergyForTick(robot, 5000);
    expect(result).toEqual({ netPowerMilliwatts: 5000, poolDeltaMilli: 0, conversion: null, starvationDeath: null });
    expect(robot.energyMilli).toBe(0);
    expect(robot.biomassCarried).toBe(10);
    expect(robot.alive).toBe(false);
  });

  it('[state] every tick leaves the remainder inside [0, 60) — the accumulator invariant', () => {
    const robot = makeRobot({ energyMilli: 123456 });
    for (const power of [80000, -80000, 1, -1, 5000, -10000]) {
      robot.energyRemainder = 0;
      runTicks(robot, power, 200);
      expect(robot.energyRemainder).toBeGreaterThanOrEqual(0);
      expect(robot.energyRemainder).toBeLessThan(TICKS_PER_SECOND);
    }
  });

  it('[repeat] 200 consecutive ticks of 5 W drain exactly 16 666 milli-units', () => {
    const robot = makeRobot({ energyMilli: 500000 });
    runTicks(robot, 5000, 200);
    // 200 × 5000/60 = 16 666 2/3: the floors telescope to 16 666 because
    // the accumulator ends the run holding 40 milliwatt-ticks.
    expect(robot.energyMilli).toBe(500000 - 16666);
    expect(robot.energyRemainder).toBe(40);
  });

  it('[determinism] the same start and power always walk the same 100-tick path', () => {
    const run = (): string => {
      const robot = makeRobot({ id: 'path', energyMilli: 250000 });
      return JSON.stringify(runTicks(robot, 5000, 100));
    };
    expect(run()).toBe(run());
  });
});

describe('the starvation chain (D6, 20 Phase 13 steps 4-5)', () => {
  it('[normal] an empty pool converts 10 biomass into 5 energy and survives', () => {
    const robot = makeRobot({ energyMilli: 0, biomassCarried: 25 });
    const result = drainEnergyForTick(robot, 5000);
    expect(result.conversion).toEqual({
      botId: robot.id,
      consumedBiomass: EMERGENCY_CONVERSION_BIOMASS,
      gainedEnergy: EMERGENCY_CONVERSION_ENERGY,
    });
    expect(robot.biomassCarried).toBe(15);
    // Drain first (83 milli-units of demand, clamped at the empty pool),
    // then the conversion tops the pool back up to 5 whole units.
    expect(robot.energyMilli).toBe(5000);
    expect(robot.alive).toBe(true);
    expect(result.starvationDeath).toBe(null);
  });

  it('[boundary] a partial scrape: 9 biomass buys 4 energy at the floored 2:1 ratio', () => {
    const robot = makeRobot({ energyMilli: 0, biomassCarried: 9 });
    const result = drainEnergyForTick(robot, 0);
    expect(result.conversion).toEqual({ botId: robot.id, consumedBiomass: 9, gainedEnergy: 4 });
    expect(robot.biomassCarried).toBe(0);
    expect(robot.energyMilli).toBe(4000);
  });

  it('[boundary] the last biomass can buy nothing: 1 biomass, 0 energy, death', () => {
    const robot = makeRobot({ energyMilli: 0, biomassCarried: 1 });
    const result = drainEnergyForTick(robot, 0);
    expect(result.conversion).toEqual({ botId: robot.id, consumedBiomass: 1, gainedEnergy: 0 });
    expect(robot.biomassCarried).toBe(0);
    expect(robot.alive).toBe(false);
    expect(result.starvationDeath).toEqual({ botId: robot.id, cause: DEATH_CAUSE_STARVATION, killerId: null });
  });

  it('[state] an empty pool with no biomass dies of starvation', () => {
    const robot = makeRobot({ energyMilli: 0 });
    const result = drainEnergyForTick(robot, 5000);
    expect(result.conversion).toBe(null);
    expect(result.starvationDeath).toEqual({ botId: robot.id, cause: DEATH_CAUSE_STARVATION, killerId: null });
    expect(robot.alive).toBe(false);
  });

  it('[state] the drain that empties the pool starves the same tick', () => {
    const robot = makeRobot({ energyMilli: 83, biomassCarried: 0 });
    const result = drainEnergyForTick(robot, 5000);
    expect(robot.energyMilli).toBe(0);
    expect(result.starvationDeath).not.toBe(null);
  });

  it('[repeat] a starving carrier converts every time the pool hits 0 until dry', () => {
    const robot = makeRobot({ energyMilli: 0, biomassCarried: 100 });
    const results = runTicks(robot, 5000, 121);
    const conversions = results.filter((result) => result.conversion !== null);
    expect(conversions).toHaveLength(3);
    expect(robot.biomassCarried).toBe(70);
    expect(robot.alive).toBe(true);
  });

  it('[determinism] the same starvation scenario produces the same record twice', () => {
    const run = (): string => {
      const robot = makeRobot({ id: 'starver', energyMilli: 0, biomassCarried: 3 });
      return JSON.stringify(drainEnergyForTick(robot, 0));
    };
    expect(run()).toBe(run());
  });
});

describe('convertCarriedBiomass — the player-issued eat batch (04 § 4.2, Phase 5)', () => {
  it('[normal] a full batch converts 10 biomass into exactly 5 energy', () => {
    const robot = makeRobot({ energyMilli: 100000, biomassCarried: 25 });
    const record = convertCarriedBiomass(robot);
    expect(record).toEqual({ botId: 'robot', consumedBiomass: 10, gainedEnergy: 5 });
    expect(robot.biomassCarried).toBe(15);
    expect(robot.energyMilli).toBe(105000);
  });

  it('[boundary] a partial batch floors the ratio: 9 buys 4, 3 buys 1, 1 buys 0', () => {
    const nine = makeRobot({ id: 'nine', energyMilli: 0, biomassCarried: 9 });
    expect(convertCarriedBiomass(nine)).toEqual({ botId: 'nine', consumedBiomass: 9, gainedEnergy: 4 });
    expect(nine.energyMilli).toBe(4000);
    const three = makeRobot({ energyMilli: 0, biomassCarried: 3 });
    expect(convertCarriedBiomass(three)).toEqual({ botId: 'robot', consumedBiomass: 3, gainedEnergy: 1 });
    const one = makeRobot({ energyMilli: 0, biomassCarried: 1 });
    expect(convertCarriedBiomass(one)).toEqual({ botId: 'robot', consumedBiomass: 1, gainedEnergy: 0 });
    expect(one.energyMilli).toBe(0);
  });

  it('[invalid] no carry is no conversion, and the pool is untouched', () => {
    const robot = makeRobot({ energyMilli: 123000, biomassCarried: 0 });
    expect(convertCarriedBiomass(robot)).toBe(null);
    expect(robot.energyMilli).toBe(123000);
  });

  it('[state] the gain clamps at the pool ceiling: the overflow is burned, never banked', () => {
    const robot = makeRobot({ energyMilli: 499000, energyMaxMilli: 500000, biomassCarried: 10 });
    const record = convertCarriedBiomass(robot);
    expect(record).toEqual({ botId: 'robot', consumedBiomass: 10, gainedEnergy: 5 });
    expect(robot.energyMilli).toBe(500000);
  });

  it('[repeat] repeated calls convert batch after batch until the carry runs dry', () => {
    const robot = makeRobot({ energyMilli: 0, biomassCarried: 22 });
    expect(convertCarriedBiomass(robot)!.consumedBiomass).toBe(10);
    expect(convertCarriedBiomass(robot)!.consumedBiomass).toBe(10);
    const last = convertCarriedBiomass(robot);
    expect(last!.consumedBiomass).toBe(2);
    expect(last!.gainedEnergy).toBe(1);
    expect(convertCarriedBiomass(robot)).toBe(null);
    expect(robot.biomassCarried).toBe(0);
    expect(robot.energyMilli).toBe(11000);
  });

  it('[determinism] the same inputs produce the same record twice', () => {
    const run = (): string => {
      const robot = makeRobot({ id: 'eater', energyMilli: 250000, biomassCarried: 7 });
      return JSON.stringify(convertCarriedBiomass(robot));
    };
    expect(run()).toBe(run());
  });
});
