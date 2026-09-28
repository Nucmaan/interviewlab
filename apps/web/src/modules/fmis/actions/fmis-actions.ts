'use server';

import { z } from 'zod';
import { createAction } from '@/lib/action';
import { postPendingNow, requestBatchReversal, retryBatch } from '../services/fmis';

const batchInput = z.object({ batchId: z.coerce.number().int().positive() });

export const postPendingAction = createAction('fmis.post', z.object({}), (_input, user) =>
  postPendingNow(user),
);
export const retryBatchAction = createAction('fmis.post', batchInput, (input, user) =>
  retryBatch(input.batchId, user),
);
export const reverseBatchAction = createAction('fmis.post', batchInput, (input, user) =>
  requestBatchReversal(input.batchId, user),
);
