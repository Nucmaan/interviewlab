/**
 * Revenue forecast with simple linear regression (POC module 7).
 *
 * We fit a straight line y = intercept + slope * x through monthly collection totals
 * (x = month number 0, 1, 2 ...) using ordinary least squares, then extend the line three months
 * forward and add them up to get next quarter's forecast.
 *
 * Why linear regression: it is easy to explain to finance users, needs little data (we have
 * 24 months) and shows the underlying trend. Its limits (explained on the dashboard and in the
 * answers): it ignores seasonality (e.g. licence renewals every January), one-off events and
 * policy changes, and it assumes the trend continues. R² tells users how well the line fits.
 */

export interface Point {
  x: number;
  y: number;
}

export interface RegressionModel {
  slope: number;
  intercept: number;
  /** Coefficient of determination: 1 = perfect fit, 0 = no better than the average. */
  rSquared: number;
  n: number;
}

export function linearRegression(points: readonly Point[]): RegressionModel {
  const n = points.length;
  if (n < 2) {
    throw new Error('Linear regression needs at least 2 data points');
  }
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - meanX) * (p.y - meanY);
    sxx += (p.x - meanX) ** 2;
  }
  if (sxx === 0) {
    throw new Error('All x values are the same; cannot fit a line');
  }
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssTotal = 0;
  let ssResidual = 0;
  for (const p of points) {
    ssTotal += (p.y - meanY) ** 2;
    ssResidual += (p.y - (intercept + slope * p.x)) ** 2;
  }
  // A flat series is perfectly explained by a flat line.
  const rSquared = ssTotal === 0 ? 1 : 1 - ssResidual / ssTotal;

  return { slope, intercept, rSquared, n };
}

export function predict(model: RegressionModel, x: number): number {
  return model.intercept + model.slope * x;
}

export interface QuarterForecast {
  model: RegressionModel;
  /** Forecast for each of the next 3 months (never negative). */
  monthly: number[];
  /** Sum of the 3 monthly forecasts, rounded to whole currency units. */
  nextQuarterTotal: number;
}

/** `monthlyTotals` must be in date order, oldest first, with no missing months. */
export function forecastNextQuarter(monthlyTotals: readonly number[]): QuarterForecast {
  if (monthlyTotals.length < 3) {
    throw new Error('At least 3 months of history are needed for a forecast');
  }
  const model = linearRegression(monthlyTotals.map((y, x) => ({ x, y })));
  const start = monthlyTotals.length;
  // Revenue cannot be negative, so a steep downward trend is floored at zero.
  const monthly = [0, 1, 2].map((i) => Math.max(0, Math.round(predict(model, start + i))));
  return {
    model,
    monthly,
    nextQuarterTotal: monthly.reduce((s, v) => s + v, 0),
  };
}
