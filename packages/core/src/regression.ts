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

export interface SeasonalForecast extends QuarterForecast {
  /** Multiplier per calendar month (index 0 = January); 1.0 = an average month. */
  seasonalFactors: number[];
  /** How well trend x seasonal factor explains the history (1 = perfectly). */
  fittedRSquared: number;
}

/**
 * The "better, justified" model: linear trend x monthly seasonal factor (classical multiplicative
 * decomposition). Revenue here is strongly seasonal - business licences are all due in January - so
 * a straight line alone explains almost none of the month-to-month variation (R² near 0). We keep
 * the regression line for the trend, then learn how much each calendar month usually sits above or
 * below it:
 *   factor[month] = average of (actual / trend) for that month, normalised so the 12 average 1
 *   forecast      = trend(x) * factor[month of x]
 * It needs at least two full years so every month has been seen at least twice.
 */
export function forecastSeasonal(
  monthlyTotals: readonly number[],
  firstCalendarMonth: number,
): SeasonalForecast {
  if (monthlyTotals.length < 24) {
    throw new Error('At least 24 months of history are needed for a seasonal forecast');
  }
  if (!Number.isInteger(firstCalendarMonth) || firstCalendarMonth < 0 || firstCalendarMonth > 11) {
    throw new RangeError('firstCalendarMonth must be 0 (January) to 11 (December)');
  }
  const model = linearRegression(monthlyTotals.map((y, x) => ({ x, y })));
  const calendarMonth = (x: number) => (firstCalendarMonth + x) % 12;

  const ratios: number[][] = Array.from({ length: 12 }, () => []);
  monthlyTotals.forEach((y, x) => {
    const trend = predict(model, x);
    if (trend > 0) ratios[calendarMonth(x)]!.push(y / trend);
  });
  const raw = ratios.map((r) => (r.length ? r.reduce((s, v) => s + v, 0) / r.length : 1));
  const mean = raw.reduce((s, v) => s + v, 0) / 12;
  const seasonalFactors = raw.map((f) => f / mean);

  const fitted = monthlyTotals.map(
    (_, x) => predict(model, x) * seasonalFactors[calendarMonth(x)]!,
  );
  const avg = monthlyTotals.reduce((s, v) => s + v, 0) / monthlyTotals.length;
  const ssTotal = monthlyTotals.reduce((s, y) => s + (y - avg) ** 2, 0);
  const ssResidual = monthlyTotals.reduce((s, y, x) => s + (y - fitted[x]!) ** 2, 0);

  const start = monthlyTotals.length;
  const monthly = [0, 1, 2].map((i) =>
    Math.max(0, Math.round(predict(model, start + i) * seasonalFactors[calendarMonth(start + i)]!)),
  );
  return {
    model,
    monthly,
    nextQuarterTotal: monthly.reduce((s, v) => s + v, 0),
    seasonalFactors,
    fittedRSquared: ssTotal === 0 ? 1 : 1 - ssResidual / ssTotal,
  };
}
