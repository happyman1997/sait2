import { countView } from '@/server/ads';
import { assertSameOrigin, clientIp, readJson, route } from '@/server/http';
import { hit } from '@/server/rate-limit';

// Показы: не больше 120 в 10 минут с одного адреса — накрутка не попадёт в отчёт.
export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const b = await readJson(req);
  const ip = clientIp(req.headers);
  if (ip && !(await hit('adview:' + ip, 120, 600)).ok) return { ok: true };
  await countView(b.ids);
  return { ok: true };
});
