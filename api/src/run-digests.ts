import { deliverPendingEmails } from './email/worker';
import { queueDailyDigests } from './jobs/daily-digests';
import { pool } from './db';

async function run(): Promise<void> {
  const centreDate = process.argv[2];
  const queued = await queueDailyDigests(centreDate);
  const processed = await deliverPendingEmails(100);
  console.log(`${queued ? 'Queued' : 'Already queued'} daily digests; processed ${processed} pending emails.`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
