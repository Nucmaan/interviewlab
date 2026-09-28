'use server';

import { z } from 'zod';
import { createAction } from '@/lib/action';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { simulateTraffic } from '../services/demo-traffic';

export const simulateTrafficAction = createAction(
  'alerts.manage',
  z.object({ count: z.coerce.number().int().min(1).max(200) }),
  (input, user) => simulateTraffic(input.count, user),
);

export const acknowledgeAlertAction = createAction(
  'alerts.manage',
  z.object({ alertId: z.coerce.number().int().positive() }),
  async (input, user) =>
    prisma.$transaction(async (tx) => {
      const alert = await tx.alert.findUnique({ where: { alert_id: input.alertId } });
      if (!alert) throw new DomainError('Alert not found', 404);
      if (alert.acknowledged_at) throw new DomainError('This alert was already acknowledged');
      await tx.alert.update({
        where: { alert_id: input.alertId },
        data: { acknowledged_by: user.userId, acknowledged_at: new Date() },
      });
      await audit(tx, user, {
        action: 'ALERT_ACKNOWLEDGED',
        entityType: 'alert',
        entityId: input.alertId,
      });
      return { alertId: input.alertId };
    }),
);
