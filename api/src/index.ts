import { createApp } from './app';
import { startEmailWorker } from './email/worker';
import { startScheduler } from './jobs/scheduler';

const app = createApp();

const port = Number(process.env.API_PORT) || 4000;

app.listen(port, () => {
  console.log(`api listening on http://localhost:${port}`);
});

startEmailWorker();
startScheduler();
