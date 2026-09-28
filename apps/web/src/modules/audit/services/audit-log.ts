import 'server-only';
import { verifyAuditLog, type Prisma } from '@ircub/db';
import { prisma } from '@/lib/db';
import { first, type PageRequest } from '@/lib/pagination';

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
}

export function parseAuditFilters(
  params: Record<string, string | string[] | undefined>,
): AuditFilters {
  const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    entityType: first(params.entityType) || undefined,
    entityId: first(params.entityId)?.trim() || undefined,
    action: first(params.action) || undefined,
    actor: first(params.actor)?.trim() || undefined,
    from: date(first(params.from)),
    to: date(first(params.to)),
  };
}

export async function listAuditLog(f: AuditFilters, page: PageRequest) {
  const where: Prisma.AuditLogWhereInput = {
    ...(f.entityType ? { entity_type: f.entityType } : {}),
    ...(f.entityId ? { entity_id: f.entityId } : {}),
    ...(f.action ? { action: f.action } : {}),
    ...(f.actor
      ? f.actor.toLowerCase() === 'system'
        ? { actor_user_id: null }
        : { actor: { email: { contains: f.actor, mode: 'insensitive' } } }
      : {}),
    ...(f.from || f.to
      ? {
          occurred_at: {
            ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}),
            ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000) } : {}),
          },
        }
      : {}),
  };
  const [rows, total, actions, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { audit_id: 'desc' },
      skip: page.skip,
      take: page.take,
      include: { actor: { select: { full_name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    }),
    prisma.auditLog.findMany({
      distinct: ['entity_type'],
      select: { entity_type: true },
      orderBy: { entity_type: 'asc' },
    }),
  ]);
  return {
    rows,
    total,
    actions: actions.map((a) => a.action),
    entityTypes: entityTypes.map((e) => e.entity_type),
  };
}

/** Recomputes the whole hash chain (see packages/core/src/audit-hash.ts). */
export function verifyChain() {
  return verifyAuditLog(prisma);
}
