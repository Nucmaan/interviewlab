/**
 * Water tariff and consumption logic (Part 1, Backend Q1 and POC module 4).
 *
 * The tariff is passed in as data (loaded from the `tariff` and `tariff_band` tables), so no rate
 * is hard-coded in this file. The billing cycle in the worker calls these functions.
 */
import { fromCents, toCents } from './money';

export interface TariffBand {
  /** Upper limit of the band in m³ (inclusive). `null` means "no upper limit" (the last band). */
  upToM3: number | null;
  ratePerM3: number;
}

export interface TariffConfig {
  serviceCharge: number;
  /** Bands ordered from lowest to highest. Each band starts where the previous one ended. */
  bands: TariffBand[];
}

export interface BandCharge {
  fromM3: number;
  toM3: number;
  units: number;
  ratePerM3: number;
  amount: number;
}

export interface WaterBillAmount {
  consumptionM3: number;
  bandCharges: BandCharge[];
  consumptionCharge: number;
  serviceCharge: number;
  total: number;
}

/** Why a reading lower than the previous one is allowed. */
export type ReadingFlag = 'NORMAL' | 'ROLLOVER' | 'METER_REPLACEMENT';

export class InvalidReadingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReadingError';
  }
}

export class InvalidTariffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTariffError';
  }
}

function assertWholeNonNegative(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidReadingError(`${label} must be a whole number of 0 or more (got ${value})`);
  }
}

/**
 * Consumption in m³ between two readings.
 *
 * - Normal: current - previous. A lower reading without a flag is rejected, because it usually
 *   means a typing mistake, and silently accepting it would under-bill the customer.
 * - Rollover: a 5-digit meter wraps from 99,999 to 00,000, so consumption is
 *   (10^digits - previous) + current. Example: 99,990 -> 00,015 = 10 + 15 = 25 m³.
 * - Meter replacement: the new meter starts at 0, so consumption is the new reading itself.
 */
export function calculateConsumption(
  previousReading: number,
  currentReading: number,
  options: { meterDigits: number; flag?: ReadingFlag },
): number {
  const { meterDigits, flag = 'NORMAL' } = options;
  assertWholeNonNegative(previousReading, 'Previous reading');
  assertWholeNonNegative(currentReading, 'Current reading');
  if (!Number.isInteger(meterDigits) || meterDigits < 1 || meterDigits > 12) {
    throw new InvalidReadingError(`Meter digits must be between 1 and 12 (got ${meterDigits})`);
  }
  const meterCapacity = 10 ** meterDigits;
  if (previousReading >= meterCapacity || currentReading >= meterCapacity) {
    throw new InvalidReadingError(`Reading does not fit on a ${meterDigits}-digit meter`);
  }

  if (flag === 'METER_REPLACEMENT') {
    return currentReading;
  }
  if (currentReading >= previousReading) {
    if (flag === 'ROLLOVER') {
      throw new InvalidReadingError(
        'Reading is flagged as rollover but is not lower than the previous reading',
      );
    }
    return currentReading - previousReading;
  }
  if (flag === 'ROLLOVER') {
    return meterCapacity - previousReading + currentReading;
  }
  throw new InvalidReadingError(
    `Current reading ${currentReading} is lower than previous reading ${previousReading}. ` +
      'Flag it as ROLLOVER or METER_REPLACEMENT if this is expected.',
  );
}

/**
 * Estimated consumption when no actual reading is available: the average of the last 3 ACTUAL
 * consumptions (rounded to a whole m³ because meters only show whole units).
 * Returns `null` if there is no actual history to estimate from, so the caller can flag the
 * account as an exception instead of guessing.
 */
export function estimateConsumption(
  history: ReadonlyArray<{ consumptionM3: number; readingType: 'ACTUAL' | 'ESTIMATED' }>,
): number | null {
  // Estimates are never based on earlier estimates, otherwise errors would compound.
  const lastThreeActual = history.filter((h) => h.readingType === 'ACTUAL').slice(0, 3);
  if (lastThreeActual.length === 0) {
    return null;
  }
  const total = lastThreeActual.reduce((sum, h) => sum + h.consumptionM3, 0);
  return Math.round(total / lastThreeActual.length);
}

export function validateTariff(tariff: TariffConfig): void {
  if (tariff.bands.length === 0) {
    throw new InvalidTariffError('Tariff must have at least one band');
  }
  if (tariff.serviceCharge < 0) {
    throw new InvalidTariffError('Service charge cannot be negative');
  }
  let previousLimit = 0;
  tariff.bands.forEach((band, index) => {
    const isLast = index === tariff.bands.length - 1;
    if (band.ratePerM3 < 0) {
      throw new InvalidTariffError(`Band ${index + 1} has a negative rate`);
    }
    if (band.upToM3 === null) {
      if (!isLast) {
        throw new InvalidTariffError('Only the last band can have no upper limit');
      }
      return;
    }
    if (band.upToM3 <= previousLimit) {
      throw new InvalidTariffError('Band limits must increase from band to band');
    }
    previousLimit = band.upToM3;
  });
  if (tariff.bands[tariff.bands.length - 1]?.upToM3 !== null) {
    throw new InvalidTariffError('The last band must have no upper limit');
  }
}

/**
 * Tiered (block) tariff: each band's rate applies only to the units inside that band.
 * With the domestic tariff: 31 m³ = 10×50 + 20×75 + 1×110 + 200 service = 2,310.
 */
export function calculateWaterBill(consumptionM3: number, tariff: TariffConfig): WaterBillAmount {
  assertWholeNonNegative(consumptionM3, 'Consumption');
  validateTariff(tariff);

  const bandCharges: BandCharge[] = [];
  let bandStart = 0;
  let consumptionCents = 0;

  for (const band of tariff.bands) {
    if (consumptionM3 <= bandStart) break;
    const bandEnd = band.upToM3 === null ? consumptionM3 : Math.min(band.upToM3, consumptionM3);
    const units = bandEnd - bandStart;
    const amountCents = units * toCents(band.ratePerM3);
    bandCharges.push({
      fromM3: bandStart,
      toM3: bandEnd,
      units,
      ratePerM3: band.ratePerM3,
      amount: fromCents(amountCents),
    });
    consumptionCents += amountCents;
    bandStart = bandEnd;
  }

  const serviceCents = toCents(tariff.serviceCharge);
  return {
    consumptionM3,
    bandCharges,
    consumptionCharge: fromCents(consumptionCents),
    serviceCharge: fromCents(serviceCents),
    total: fromCents(consumptionCents + serviceCents),
  };
}
