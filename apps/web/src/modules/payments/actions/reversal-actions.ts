'use server';

import { z } from 'zod';
import { createAction } from '@/lib/action';
import { decideReversal, requestReversal } from '../services/reversals';

export const requestReversalAction = createAction(
  'reversals.request',
  z.object({
    paymentId: z.coerce.number().int().positive(),
    reason: z.string().trim().min(10, 'Explain the reason (at least 10 characters)').max(300),
  }),
  (input, user) => requestReversal(input.paymentId, input.reason, user),
);

export const decideReversalAction = createAction(
  'reversals.approve',
  z.object({
    reversalId: z.coerce.number().int().positive(),
    approve: z.boolean(),
    note: z.string().trim().max(300).optional(),
  }),
  (input, user) => decideReversal(input.reversalId, input.approve, input.note, user),
);
