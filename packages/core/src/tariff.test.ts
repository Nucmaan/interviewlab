import { describe, expect, it } from 'vitest';
import {
  calculateConsumption,
  calculateWaterBill,
  estimateConsumption,
  InvalidReadingError,
  InvalidTariffError,
  type TariffConfig,
} from './tariff';

// Same values as the seeded DOMESTIC tariff; in the app they are loaded from the database.
const domestic: TariffConfig = {
  serviceCharge: 200,
  bands: [
    { upToM3: 10, ratePerM3: 50 },
    { upToM3: 30, ratePerM3: 75 },
    { upToM3: null, ratePerM3: 110 },
  ],
};

describe('calculateWaterBill (domestic tiered tariff)', () => {
  it.each([
    [0, 200],
    [1, 250],
    [10, 700],
    [11, 775],
    [30, 2200],
    [31, 2310],
    [45, 3850],
  ])('%i m³ costs %i', (consumption, expected) => {
    expect(calculateWaterBill(consumption, domestic).total).toBe(expected);
  });

  it('only charges the service charge for zero consumption', () => {
    const bill = calculateWaterBill(0, domestic);
    expect(bill.consumptionCharge).toBe(0);
    expect(bill.bandCharges).toEqual([]);
  });

  it('returns a per-band breakdown for the bill', () => {
    const bill = calculateWaterBill(31, domestic);
    expect(bill.bandCharges.map((b) => [b.units, b.amount])).toEqual([
      [10, 500],
      [20, 1500],
      [1, 110],
    ]);
  });

  it('uses whatever rates the configuration provides', () => {
    const commercial: TariffConfig = {
      serviceCharge: 500,
      bands: [
        { upToM3: 20, ratePerM3: 90 },
        { upToM3: null, ratePerM3: 130 },
      ],
    };
    expect(calculateWaterBill(25, commercial).total).toBe(500 + 20 * 90 + 5 * 130);
  });

  it('keeps cents exact for fractional rates', () => {
    const tariff: TariffConfig = { serviceCharge: 0.1, bands: [{ upToM3: null, ratePerM3: 0.2 }] };
    expect(calculateWaterBill(3, tariff).total).toBe(0.7);
  });

  it('rejects negative or fractional consumption', () => {
    expect(() => calculateWaterBill(-1, domestic)).toThrow(InvalidReadingError);
    expect(() => calculateWaterBill(1.5, domestic)).toThrow(InvalidReadingError);
  });

  it('rejects a tariff whose last band has an upper limit', () => {
    const broken: TariffConfig = { serviceCharge: 200, bands: [{ upToM3: 10, ratePerM3: 50 }] };
    expect(() => calculateWaterBill(5, broken)).toThrow(InvalidTariffError);
  });

  it('rejects band limits that do not increase', () => {
    const broken: TariffConfig = {
      serviceCharge: 200,
      bands: [
        { upToM3: 30, ratePerM3: 50 },
        { upToM3: 10, ratePerM3: 75 },
        { upToM3: null, ratePerM3: 110 },
      ],
    };
    expect(() => calculateWaterBill(5, broken)).toThrow(InvalidTariffError);
  });
});

describe('calculateConsumption', () => {
  it('is current minus previous for a normal reading', () => {
    expect(calculateConsumption(1200, 1225, { meterDigits: 5 })).toBe(25);
  });

  it('handles a 5-digit meter rollover from 99,990 to 00,015 as 25 m³', () => {
    expect(calculateConsumption(99990, 15, { meterDigits: 5, flag: 'ROLLOVER' })).toBe(25);
  });

  it('treats a meter replacement as starting from zero', () => {
    expect(calculateConsumption(54321, 12, { meterDigits: 5, flag: 'METER_REPLACEMENT' })).toBe(12);
  });

  it('rejects a lower reading that is not flagged', () => {
    expect(() => calculateConsumption(500, 480, { meterDigits: 5 })).toThrow(InvalidReadingError);
  });

  it('rejects a rollover flag when the reading did not go down', () => {
    expect(() => calculateConsumption(500, 520, { meterDigits: 5, flag: 'ROLLOVER' })).toThrow(
      InvalidReadingError,
    );
  });

  it('rejects a reading that does not fit on the meter', () => {
    expect(() => calculateConsumption(0, 100000, { meterDigits: 5 })).toThrow(InvalidReadingError);
  });

  it('allows zero consumption', () => {
    expect(calculateConsumption(700, 700, { meterDigits: 5 })).toBe(0);
  });
});

describe('estimateConsumption', () => {
  it('averages the last 3 ACTUAL readings and ignores estimates', () => {
    const history = [
      { consumptionM3: 99, readingType: 'ESTIMATED' as const },
      { consumptionM3: 20, readingType: 'ACTUAL' as const },
      { consumptionM3: 25, readingType: 'ACTUAL' as const },
      { consumptionM3: 30, readingType: 'ACTUAL' as const },
      { consumptionM3: 500, readingType: 'ACTUAL' as const },
    ];
    expect(estimateConsumption(history)).toBe(25);
  });

  it('uses what is available when there are fewer than 3 actual readings', () => {
    expect(
      estimateConsumption([
        { consumptionM3: 10, readingType: 'ACTUAL' },
        { consumptionM3: 13, readingType: 'ACTUAL' },
      ]),
    ).toBe(12);
  });

  it('returns null when there is no actual history', () => {
    expect(estimateConsumption([])).toBeNull();
    expect(estimateConsumption([{ consumptionM3: 10, readingType: 'ESTIMATED' }])).toBeNull();
  });

  it('returns 0 when the history is all zero consumption', () => {
    expect(estimateConsumption([{ consumptionM3: 0, readingType: 'ACTUAL' }])).toBe(0);
  });
});
