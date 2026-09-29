import { AppError } from '@/server/errors';
import { geoSearch } from '@/server/geo';
import { requestCtx, route } from '@/server/http';
import { limitOrThrow } from '@/server/rate-limit';

export const GET = route(async (req) => {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 200);
  if (q.length < 3) throw new AppError(422, 'Введите адрес подробнее.');
  const { ip } = await requestCtx();
  await limitOrThrow(`geo:${ip || 'anon'}`, 120, 600, 'Слишком много запросов адреса — подождите пару минут.');
  return { hits: await geoSearch(q) };
});
