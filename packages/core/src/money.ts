/**
 * Money helpers.
 *
 * JavaScript numbers are binary floating point, so 0.1 + 0.2 !== 0.3. To keep money exact we do
 * every intermediate calculation in integer cents and only convert back to a decimal amount at the
 * end. Amounts in IRCUB stay far below Number.MAX_SAFE_INTEGER cents (about 90 trillion), so
 * integer cents are exact for our range.
 */

export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Invalid money amount: ${amount}`);
  }
  // Math.round (not trunc) so 19.99 stored as 19.989999... still becomes 1999 cents.
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Rounds a decimal amount to 2 decimal places using half-up rounding on cents. */
export function roundMoney(amount: number): number {
  return fromCents(toCents(amount));
}

export function sumMoney(amounts: readonly number[]): number {
  return fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0));
}

/** Multiplies an amount by a percentage (e.g. 5 = 5%) and rounds half-up to the cent. */
export function percentOf(amount: number, percent: number): number {
  return fromCents(Math.round((toCents(amount) * percent) / 100));
}
