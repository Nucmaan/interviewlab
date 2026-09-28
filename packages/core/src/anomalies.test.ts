import { describe, expect, it } from 'vitest';
import { detectCollectionDrop, detectReversalSpike, isAbnormalConsumption } from './anomalies';

describe('detectCollectionDrop', () => {
  const lastWeek = [1000, 1100, 900, 1000, 1000, 1050, 950];

  it('flags a day at half of the 7-day average', () => {
    expect(detectCollectionDrop(500, lastWeek, 50).isAnomaly).toBe(true);
  });

  it('does not flag a normal day', () => {
    expect(detectCollectionDrop(900, lastWeek, 50).isAnomaly).toBe(false);
  });

  it('does not flag when there is no history', () => {
    expect(detectCollectionDrop(0, [], 50).isAnomaly).toBe(false);
  });
});

describe('detectReversalSpike', () => {
  it('flags three times the usual reversals', () => {
    expect(detectReversalSpike(9, [2, 3, 3, 2, 4, 3, 4], 3, 5).isAnomaly).toBe(true);
  });

  it('ignores small absolute numbers', () => {
    expect(detectReversalSpike(2, [0, 0, 0, 0, 0, 0, 0], 3, 5).isAnomaly).toBe(false);
  });
});

describe('isAbnormalConsumption', () => {
  it('flags consumption above 200% of the 3-month average', () => {
    expect(isAbnormalConsumption(61, [20, 30, 40], 200)).toBe(true);
  });

  it('accepts consumption at exactly 200% of the average', () => {
    expect(isAbnormalConsumption(60, [20, 30, 40], 200)).toBe(false);
  });

  it('uses only the 3 most recent months', () => {
    expect(isAbnormalConsumption(50, [20, 20, 20, 500], 200)).toBe(true);
  });

  it('flags any usage after three zero months', () => {
    expect(isAbnormalConsumption(5, [0, 0, 0], 200)).toBe(true);
    expect(isAbnormalConsumption(0, [0, 0, 0], 200)).toBe(false);
  });

  it('does not flag new accounts with no history', () => {
    expect(isAbnormalConsumption(500, [], 200)).toBe(false);
  });
});
