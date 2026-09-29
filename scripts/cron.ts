// Разовый запуск фоновых задач для внешнего планировщика (systemd timer, cron в облаке).
import { runDueTasks } from '../server/cron';
import { pool } from '../server/db';

runDueTasks()
  .then(r => { console.log(JSON.stringify(r)); return pool().end(); })
  .catch(e => { console.error(e); process.exit(1); });
