/**
 * Mock FMIS (government Financial Management Information System).
 *
 *   POST /fmis/journals                    post a balanced journal, returns an FMIS reference
 *   POST /fmis/journals/:reference/reverse reverse a posted journal
 *   GET  /fmis/totals?from=&to=            posted totals per day and GL code (for reconciliation)
 *
 * Like a real ledger it refuses unbalanced journals, and it is idempotent on batchRef: posting the
 * same batch twice returns the first reference instead of booking the money twice.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { persist, runtime, shouldFail, simulateLatency, state } from '../state';

const journalSchema = z.object({
  batchRef: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journalType: z.enum(['COLLECTION', 'REVERSAL']),
  lines: z
    .array(
      z.object({ glCode: z.string().min(1), debit: z.number().min(0), credit: z.number().min(0) }),
    )
    .min(2),
});

const cents = (n: number) => Math.round(n * 100);

export function registerFmisRoutes(app: FastifyInstance): void {
  app.post('/fmis/journals', async (request, reply) => {
    await simulateLatency();
    if (runtime.fmisDown || shouldFail()) {
      return reply.code(503).send({ error: 'FMIS temporarily unavailable' });
    }
    const parsed = journalSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const journal = parsed.data;

    const debit = journal.lines.reduce((s, l) => s + cents(l.debit), 0);
    const credit = journal.lines.reduce((s, l) => s + cents(l.credit), 0);
    if (debit !== credit) {
      return reply
        .code(422)
        .send({ error: `Journal not balanced: debit ${debit / 100} != credit ${credit / 100}` });
    }
    const existing = state.journals.find((j) => j.batchRef === journal.batchRef);
    if (existing) return { fmisReference: existing.fmisReference, duplicate: true };

    const fmisReference = `FMIS-${journal.businessDate.replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    state.journals.push({
      ...journal,
      fmisReference,
      reversed: false,
      postedAt: new Date().toISOString(),
    });
    persist();
    return reply.code(201).send({ fmisReference });
  });

  app.post<{ Params: { reference: string } }>(
    '/fmis/journals/:reference/reverse',
    async (request, reply) => {
      await simulateLatency();
      if (runtime.fmisDown) return reply.code(503).send({ error: 'FMIS temporarily unavailable' });
      const journal = state.journals.find((j) => j.fmisReference === request.params.reference);
      if (!journal) return reply.code(404).send({ error: 'Unknown FMIS reference' });
      journal.reversed = true;
      persist();
      return { fmisReference: `${journal.fmisReference}-REV` };
    },
  );

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/fmis/totals',
    async (request, reply) => {
      const { from, to } = request.query;
      if (!from || !to)
        return reply.code(400).send({ error: 'from and to (YYYY-MM-DD) are required' });
      const totals = new Map<
        string,
        { businessDate: string; glCode: string; debit: number; credit: number }
      >();
      for (const journal of state.journals) {
        if (journal.reversed || journal.businessDate < from || journal.businessDate > to) continue;
        for (const line of journal.lines) {
          const key = `${journal.businessDate}|${line.glCode}`;
          const t = totals.get(key) ?? {
            businessDate: journal.businessDate,
            glCode: line.glCode,
            debit: 0,
            credit: 0,
          };
          t.debit += cents(line.debit);
          t.credit += cents(line.credit);
          totals.set(key, t);
        }
      }
      return [...totals.values()].map((t) => ({
        ...t,
        debit: t.debit / 100,
        credit: t.credit / 100,
      }));
    },
  );
}
