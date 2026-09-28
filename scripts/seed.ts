// Демо-аккаунты для разработки (как в прототипе): daniyar_s — исполнитель, aigul_t — работодатель. Пароль: demo123.
import { pool, tx } from '../server/db';
import { hashPassword } from '../server/password';

if (process.env.NODE_ENV === 'production') {
  console.error('Сид демо-данных в продакшене запрещён.');
  process.exit(1);
}

async function main() {
  const hash = await hashPassword('demo123');
  await tx(async (db) => {
    const f = await db.query(
      `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
       VALUES ('freelancer', 'daniyar_s', '+79160000000', '9160000000', 'daniyar@example.ru', $1, 'Данияр Сапаров', 'Москва', 55.7558, 37.6173, now(), 'seed')
       ON CONFLICT DO NOTHING RETURNING id`, [hash]);
    if (f.rows[0]) {
      await db.query(`INSERT INTO freelancer_profiles (user_id, skills, gear, own_car, work_cities) VALUES ($1, '{snow,ice,grass}', '{"Лопата и скребок","Снегоуборщик"}', true, '{Москва,Химки}')`, [f.rows[0].id]);
      await db.query('INSERT INTO notification_settings (user_id) VALUES ($1)', [f.rows[0].id]);
    }
    const e = await db.query(
      `INSERT INTO users (role, login, phone, phone_key, email, password_hash, name, city, base_lat, base_lng, offer_accepted_at, offer_version)
       VALUES ('employer', 'aigul_t', '+79161111111', '9161111111', 'aigul@example.ru', $1, 'Айгуль Тлеубаева', 'Москва', 55.7558, 37.6173, now(), 'seed')
       ON CONFLICT DO NOTHING RETURNING id`, [hash]);
    if (e.rows[0]) {
      await db.query(`INSERT INTO employer_profiles (user_id, org_type, org_name, access, tools) VALUES ($1, 'частное лицо', 'Айгуль Тлеубаева', '{домофон,"встречу лично"}', 'инвентарь есть на объекте')`, [e.rows[0].id]);
      await db.query('INSERT INTO notification_settings (user_id) VALUES ($1)', [e.rows[0].id]);
    }
  });
  console.log('seed ok: daniyar_s / aigul_t, пароль demo123');
  await pool().end();
}

main().catch((e) => { console.error(e); process.exit(1); });
