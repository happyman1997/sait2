import { KM_STEPS } from '@/lib/catalog';
import { assertSameOrigin, currentUser, readJson, route } from '@/server/http';
import { clientToday, createJob, listJobs } from '@/server/jobs';

export const GET = route(async (req) => {
  const u = new URL(req.url);
  const p = u.searchParams;
  const num = (k: string) => { const v = parseFloat(p.get(k) || ''); return Number.isFinite(v) ? v : undefined; };
  const km = num('km');
  return listJobs({
    types: (p.get('types') || '').split(',').filter(Boolean),
    minPay: Math.min(10_000_000, Math.max(0, num('minPay') || 0)),
    km: km && KM_STEPS.includes(km) ? km : undefined,
    when: p.get('when') === 'soon' ? 'soon' : 'any',
    q: p.get('q') || '',
    today: clientToday(p.get('today')),
    lat: num('lat'),
    lng: num('lng')
  }, await currentUser());
});

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  const b = await readJson(req);
  return { job: await createJob(b.job, await currentUser(), b.today) };
});
