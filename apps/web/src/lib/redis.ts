import 'server-only';
import { getRedis } from '@ircub/platform';

/** Shared Redis connection, created on first use so builds do not try to connect. */
export const redis = () => getRedis();
