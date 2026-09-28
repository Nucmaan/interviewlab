/**
 * Daily overdue-penalty run (Part 1, SQL Q3 - application-service version).
 * The rules live in @ircub/core (calculatePenalty); the same rules exist as a PostgreSQL function
 * in sql/05-penalty-procedure.sql. Both are idempotent in the same way:
 *
 *   - the TOTAL penalty is recalculated and SET (never added to), and never lowered;
 *   - penalty_history has UNIQUE(assessment_id, run_date) and we insert with skipDuplicates
 *     (= ON CONFLICT DO NOTHING), so a second run on the same day adds no rows;
 *   - each chunk of assessments is locked (FOR UPDATE) and updated in one transaction.
 */
import { calculatePenalty, DEFAULT_PENALTY_RULES, type PenaltyRules } from '@ircub/core';
import { getConfig, toNumber } from '@ircub/db';
import type { WorkerContext } from '../lib/context';

const CHUNK = 500;

export interface PenaltyRunResult {
  runDate: string;
  examined: number;
  updated: number;
  historyRows: number;
}

export async function runPenalties(
  ctx: WorkerContext,
  runDate: Date = new Date(),
): Promise<PenaltyRunResult> {
  const rules = await getConfig<PenaltyRules>(ctx.prisma, 'penalty_rules', DEFAULT_PENALTY_RULES);
  const day = new Date(
    Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate()),
  );
  const result: PenaltyRunResult = {
    runDate: day.toISOString().slice(0, 10),
    examined: 0,
    updated: 0,
    historyRows: 0,
  };
  let afterId = 0;

  for (;;) {
    const chunk = await ctx.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ assessment_id: number }[]>`
        SELECT assessment_id FROM assessment
        WHERE status IN ('OPEN', 'PART_PAID') AND due_date < ${day} AND assessment_id > ${afterId}
        ORDER BY assessment_id
        LIMIT ${CHUNK}
        FOR UPDATE`;
      if (rows.length === 0) return null;
      const assessments = await tx.assessment.findMany({
        where: { assessment_id: { in: rows.map((r) => r.assessment_id) } },
        orderBy: { assessment_id: 'asc' },
      });

      let updated = 0;
      const history = [];
      for (const a of assessments) {
        const penalty = calculatePenalty(
          {
            amountDue: toNumber(a.amount_due),
            amountPaid: toNumber(a.amount_paid),
            dueDate: a.due_date,
            runDate: day,
            currentPenalty: toNumber(a.penalty_amount),
          },
          rules,
        );
        if (penalty.monthsOverdue === 0 || penalty.unpaidAmount === 0) continue;
        if (penalty.penaltyAmount !== toNumber(a.penalty_amount)) {
          // SET the recalculated total - never "penalty_amount + x".
          await tx.assessment.update({
            where: { assessment_id: a.assessment_id },
            data: { penalty_amount: penalty.penaltyAmount },
          });
          updated++;
        }
        history.push({
          assessment_id: a.assessment_id,
          run_date: day,
          months_overdue: penalty.monthsOverdue,
          unpaid_amount: penalty.unpaidAmount,
          penalty_amount: penalty.penaltyAmount,
        });
      }
      const inserted = await tx.penaltyHistory.createMany({ data: history, skipDuplicates: true });
      return {
        lastId: rows[rows.length - 1]!.assessment_id,
        examined: rows.length,
        updated,
        inserted: inserted.count,
      };
    });
    if (!chunk) break;
    afterId = chunk.lastId;
    result.examined += chunk.examined;
    result.updated += chunk.updated;
    result.historyRows += chunk.inserted;
  }

  ctx.logger.info(result, 'penalty run finished');
  return result;
}
