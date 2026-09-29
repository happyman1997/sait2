import { startScheduler } from './server/cron';

if (process.env.DISABLE_SCHEDULER !== '1') startScheduler();
