import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

/** Liveness + readiness: the app is only healthy if it can reach PostgreSQL and Redis. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis().ping();
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    logger.error({ err: error }, 'health check failed');
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
}
