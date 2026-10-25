import { AppError } from '@/server/errors';
import { currentUser, route } from '@/server/http';
import { areaJobs, clientToday } from '@/server/jobs';

// Что в кадре карты — когда подходящих заказов больше, чем приходит от базы (/api/jobs отвечает more: true).
export const GET = route(async (req) => {
  const p = new URL(req.url).searchParams;
  const num = (k: string) => { const v = parseFloat(p.get(k) || ''); return Number.isFinite(v) ? v : undefined; };
  const [w, s, e, n, zoom] = ['w', 's', 'e', 'n', 'z'].map(num);
  if (w == null || s == null || e == null || n == null || zoom == null || Math.abs(s) > 90 || Math.abs(n) > 90 || zoom < 0 || zoom > 24) {
    throw new AppError(400, 'Не понял, какую часть карты показать.');
  }
  const km = num('km');
  return areaJobs({
    w, s, e, n, zoom,
    types: (p.get('types') || '').split(',').filter(Boolean),
    minPay: Math.min(10_000_000, Math.max(0, num('minPay') || 0)),
    km: km && Number.isInteger(km) && km > 0 && km <= 1000 ? km : undefined,
    when: p.get('when') === 'soon' ? 'soon' : 'any',
    q: p.get('q') || '',
    today: clientToday(p.get('today')),
    lat: num('lat'),
    lng: num('lng')
  }, await currentUser());
});
