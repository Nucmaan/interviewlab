'use server';

import { createAction } from '@/lib/action';
import { payerSchema, reviewDuplicateSchema, updatePayerSchema } from '../schemas/payer';
import { createPayer, reviewDuplicate, updatePayer } from '../services/payers';

export const createPayerAction = createAction('payers.create', payerSchema, createPayer);

export const updatePayerAction = createAction(
  'payers.edit',
  updatePayerSchema,
  ({ payerId, ...input }, user) => updatePayer(payerId, input, user),
);

export const reviewDuplicateAction = createAction(
  'duplicates.review',
  reviewDuplicateSchema,
  (input, user) => reviewDuplicate(input.flagId, input.decision, user),
);
