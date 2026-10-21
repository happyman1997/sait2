import { parseNum, route } from '@/server/http';
import { getJob } from '@/server/jobs';
import { jobOgImage } from '@/server/og';

type Ctx = { params: Promise<{ num: string }> };

// Картинка-превью ссылки на заказ (/?job=N) для мессенджеров — по гостевой карточке.
export async function GET(req: Request, ctx: Ctx) {
  const { num } = await ctx.params;
  return route(async () => jobOgImage(await getJob(parseNum(num), null)))(req);
}
