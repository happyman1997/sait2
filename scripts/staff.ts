// Роль поддержки: npm run staff -- add <логин> | remove <логин> | list
import { pool, query } from '../server/db';

async function main() {
  const [cmd, login] = process.argv.slice(2);
  if (cmd === 'list') {
    console.table((await query('SELECT login, name, role, status FROM users WHERE is_staff ORDER BY login')).rows);
  } else if ((cmd === 'add' || cmd === 'remove') && login) {
    const r = await query('UPDATE users SET is_staff = $2 WHERE lower(login) = lower($1) RETURNING login', [login, cmd === 'add']);
    console.log(r.rowCount ? (cmd === 'add' ? 'выдана роль поддержки: ' : 'снята роль поддержки: ') + r.rows[0].login : 'логин не найден');
  } else {
    console.log('команды: list | add <логин> | remove <логин>');
  }
}

main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => pool().end());
