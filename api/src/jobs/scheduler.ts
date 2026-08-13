import cron, { type ScheduledTask } from 'node-cron';
import { CENTRE_TIMEZONE, queueDailyDigests } from './daily-digests';

export function startScheduler(): ScheduledTask | null {
  if (process.env.SCHEDULER_ENABLED === 'false') return null;

  void queueDailyDigests().catch(console.error);
  return cron.schedule('0 0 * * *', () => void queueDailyDigests().catch(console.error), {
    timezone: CENTRE_TIMEZONE
  });
}
