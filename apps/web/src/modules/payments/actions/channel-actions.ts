'use server';

import { z } from 'zod';
import { createAction } from '@/lib/action';
import { fetchChannelStatement, reconcileChannelDay } from '../services/channel-reconciliation';
import { initiateMobilePayment } from '../services/portal';

export const initiatePaymentAction = createAction(
  'self.pay',
  z.object({
    target: z.enum(['assessment', 'bill']),
    targetId: z.coerce.number().int().positive(),
    currency: z.enum(['USD', 'SOS']),
    msisdn: z
      .string()
      .trim()
      .regex(/^\+?\d{9,15}$/, 'Enter the mobile number that will pay, e.g. +252615551234'),
  }),
  initiateMobilePayment,
);

export const reconcileChannelAction = createAction(
  'reconciliation.run',
  z.object({
    channel: z.enum(['BANK', 'MOBILE_MONEY']),
    date: z.iso.date(),
    /** Uploaded statement CSV; when empty the statement is downloaded from the channel. */
    csv: z.string().max(10_000_000).optional(),
  }),
  async (input, user) => {
    const csv = input.csv?.trim()
      ? input.csv
      : await fetchChannelStatement(input.channel, input.date);
    return reconcileChannelDay(input.channel, input.date, csv, user);
  },
);
