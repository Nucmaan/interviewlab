'use server';

import { z } from 'zod';
import { createAction } from '@/lib/action';
import { DomainError } from '@/lib/errors';
import { assessmentSchema, revenueTypeSchema } from '../schemas/revenue';
import { createAssessment } from '../services/assessments';
import { processCsvUpload } from '../services/csv-upload';
import { saveRevenueType } from '../services/revenue-types';

export const saveRevenueTypeAction = createAction(
  'revenue_types.manage',
  revenueTypeSchema,
  saveRevenueType,
);

export const createAssessmentAction = createAction(
  'assessments.create',
  assessmentSchema,
  createAssessment,
);

/** Payments CSV needs payments.upload; assessments CSV needs assessments.create (checked below). */
export const uploadCsvAction = createAction(
  ['payments.upload', 'assessments.create'],
  z.object({
    kind: z.enum(['payments', 'assessments']),
    fileName: z.string().trim().min(1).max(200),
    csv: z.string().min(1).max(10_000_000),
  }),
  async (input, user) => {
    const needed = input.kind === 'payments' ? 'payments.upload' : 'assessments.create';
    if (!user.permissions.has(needed)) {
      throw new DomainError(`You need the ${needed} permission to upload this file`);
    }
    return processCsvUpload(input.kind, input.fileName, input.csv, user);
  },
);
