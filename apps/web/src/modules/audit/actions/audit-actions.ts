'use server';

import { z } from 'zod';
import { createAction } from '@/lib/action';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { verifyChain } from '../services/audit-log';

export const verifyChainAction = createAction(
  'audit.verify',
  z.object({}),
  async (_input, user) => {
    const started = Date.now();
    const result = await verifyChain();
    // Running the check is itself an auditable event.
    await prisma.$transaction((tx) =>
      audit(tx, user, {
        action: 'AUDIT_CHAIN_VERIFIED',
        entityType: 'audit_log',
        entityId: 'chain',
        after: result,
      }),
    );
    return { ...result, durationMs: Date.now() - started };
  },
);
