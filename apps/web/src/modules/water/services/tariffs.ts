import 'server-only';
import { validateTariff, type TariffBand } from '@ircub/core';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError, NotFoundError } from '@/lib/errors';
import type { CurrentUser } from '@/lib/rbac';

/** Parses "10:50\n30:75\n*:110" into bands; "*" means no upper limit. */
export function parseBands(text: string): TariffBand[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = /^(\*|\d+)\s*:\s*(\d+(?:\.\d{1,2})?)$/.exec(line);
      if (!match) throw new DomainError(`Band line ${index + 1} must look like "10:50" or "*:110"`);
      return { upToM3: match[1] === '*' ? null : Number(match[1]), ratePerM3: Number(match[2]) };
    });
}

/**
 * Changes a tariff's service charge and bands. The new values are checked with the same rules
 * the bill calculation uses (validateTariff), so an unusable tariff can never be saved.
 * Bills already issued keep their amounts; the next billing cycle uses the new values.
 */
export async function updateTariff(
  tariffId: number,
  serviceCharge: number,
  bandsText: string,
  user: CurrentUser,
) {
  const bands = parseBands(bandsText);
  try {
    validateTariff({ serviceCharge, bands });
  } catch (error) {
    throw new DomainError((error as Error).message);
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.tariff.findUnique({
      where: { tariff_id: tariffId },
      include: { bands: { orderBy: { sort_order: 'asc' } } },
    });
    if (!before) throw new NotFoundError('Tariff');
    await tx.tariff.update({
      where: { tariff_id: tariffId },
      data: {
        service_charge: serviceCharge,
        bands: {
          deleteMany: {},
          create: bands.map((b, i) => ({
            sort_order: i + 1,
            up_to_m3: b.upToM3,
            rate_per_m3: b.ratePerM3,
          })),
        },
      },
    });
    await audit(tx, user, {
      action: 'TARIFF_UPDATED',
      entityType: 'tariff',
      entityId: tariffId,
      before: {
        serviceCharge: before.service_charge,
        bands: before.bands.map((b) => ({ upToM3: b.up_to_m3, ratePerM3: b.rate_per_m3 })),
      },
      after: { serviceCharge, bands },
    });
    return { tariffId };
  });
}
