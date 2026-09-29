import { AppError } from '@/server/errors';
import { geoReverse } from '@/server/geo';
import { requestCtx, route } from '@/server/http';
import { limitOrThrow } from '@/server/rate-limit';

export const GET = route(async (req) => {
  const p = new URL(req.url).searchParams;
  const lat = parseFloat(p.get('lat') || ''), lng = parseFloat(p.get('lng') || '');
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new AppError(422, 'Некорректные координаты.');
  const { ip } = await requestCtx();
  await limitOrThrow(`geo:${ip || 'anon'}`, 120, 600, 'Слишком много запросов адреса — подождите пару минут.');
  return { hit: await geoReverse(lat, lng) };
});
