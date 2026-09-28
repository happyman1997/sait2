import { pool } from '../server/db';
import { migrate } from '../server/migrate';

migrate(pool())
  .then(() => { console.log('ok'); return pool().end(); })
  .catch((e) => { console.error(e.message); process.exit(1); });
