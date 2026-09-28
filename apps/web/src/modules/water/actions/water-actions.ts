'use server';

import { z } from 'zod';
import { createAction } from '@/lib/action';
import {
  readingSchema,
  releaseBillSchema,
  runCycleSchema,
  tariffBandsSchema,
} from '../schemas/water';
import { releaseBill, startBillingCycle } from '../services/billing';
import { captureReading, uploadReadings } from '../services/readings';
import { updateTariff } from '../services/tariffs';

export const captureReadingAction = createAction('readings.capture', readingSchema, captureReading);

export const uploadReadingsAction = createAction(
  'readings.capture',
  z.object({ csv: z.string().min(1).max(10_000_000) }),
  (input, user) => uploadReadings(input.csv, user),
);

export const runBillingCycleAction = createAction('billing.run', runCycleSchema, (input, user) =>
  startBillingCycle(input.billingMonth, user),
);

export const releaseBillAction = createAction('billing.release', releaseBillSchema, (input, user) =>
  releaseBill(input.billId, user),
);

export const updateTariffAction = createAction(
  'water.accounts.manage',
  tariffBandsSchema,
  (input, user) => updateTariff(input.tariffId, input.serviceCharge, input.bands, user),
);
