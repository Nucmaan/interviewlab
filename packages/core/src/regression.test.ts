import { describe, expect, it } from 'vitest';
import { forecastNextQuarter, forecastSeasonal, linearRegression, predict } from './regression';

describe('linearRegression', () => {
  it('recovers a perfect straight line', () => {
    const model = linearRegression([
      { x: 0, y: 10 },
      { x: 1, y: 12 },
      { x: 2, y: 14 },
      { x: 3, y: 16 },
    ]);
    expect(model.slope).toBeCloseTo(2);
    expect(model.intercept).toBeCloseTo(10);
    expect(model.rSquared).toBeCloseTo(1);
    expect(predict(model, 10)).toBeCloseTo(30);
  });

  it('gives a lower R² for noisy data', () => {
    const model = linearRegression([
      { x: 0, y: 10 },
      { x: 1, y: 30 },
      { x: 2, y: 5 },
      { x: 3, y: 25 },
    ]);
    expect(model.rSquared).toBeLessThan(0.5);
  });

  it('treats a flat series as a perfect fit with zero slope', () => {
    const model = linearRegression([
      { x: 0, y: 5 },
      { x: 1, y: 5 },
    ]);
    expect(model.slope).toBe(0);
    expect(model.rSquared).toBe(1);
  });

  it('needs at least two distinct points', () => {
    expect(() => linearRegression([{ x: 0, y: 1 }])).toThrow();
    expect(() =>
      linearRegression([
        { x: 1, y: 1 },
        { x: 1, y: 2 },
      ]),
    ).toThrow();
  });
});

describe('forecastNextQuarter', () => {
  it('extends a growing trend three months forward', () => {
    // 100, 110, ... 150 -> next three months 160, 170, 180
    const forecast = forecastNextQuarter([100, 110, 120, 130, 140, 150]);
    expect(forecast.monthly).toEqual([160, 170, 180]);
    expect(forecast.nextQuarterTotal).toBe(510);
  });

  it('never forecasts negative revenue', () => {
    const forecast = forecastNextQuarter([300, 200, 100]);
    expect(forecast.monthly).toEqual([0, 0, 0]);
  });

  it('requires at least 3 months of history', () => {
    expect(() => forecastNextQuarter([1, 2])).toThrow();
  });
});

describe('forecastSeasonal', () => {
  // 3 years starting in January: steady growth, and every January is 4x a normal month.
  const series = Array.from({ length: 36 }, (_, x) => (100 + 2 * x) * (x % 12 === 0 ? 4 : 1));

  it('learns that January is far above the trend', () => {
    const f = forecastSeasonal(series, 0);
    expect(f.seasonalFactors[0]).toBeGreaterThan(3);
    expect(f.seasonalFactors[5]).toBeLessThan(1);
  });

  it('explains a seasonal series much better than a straight line', () => {
    const seasonal = forecastSeasonal(series, 0);
    const linear = linearRegression(series.map((y, x) => ({ x, y })));
    expect(linear.rSquared).toBeLessThan(0.1);
    expect(seasonal.fittedRSquared).toBeGreaterThan(0.9);
  });

  it('forecasts the next January spike', () => {
    // History ends in December, so the next three months are January to March.
    const f = forecastSeasonal(series, 0);
    expect(f.monthly[0]!).toBeGreaterThan(3 * f.monthly[1]!);
  });

  it('keeps seasonal factors averaging 1', () => {
    const f = forecastSeasonal(series, 0);
    const mean = f.seasonalFactors.reduce((s, v) => s + v, 0) / 12;
    expect(mean).toBeCloseTo(1);
  });

  it('needs two full years and a valid start month', () => {
    expect(() => forecastSeasonal(series.slice(0, 23), 0)).toThrow();
    expect(() => forecastSeasonal(series, 12)).toThrow(RangeError);
  });
});
