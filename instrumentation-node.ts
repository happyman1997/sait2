import { startScheduler } from './server/cron';
import { assertProductionConfig } from './server/startup-check';

assertProductionConfig();
if (process.env.DISABLE_SCHEDULER !== '1') startScheduler();
