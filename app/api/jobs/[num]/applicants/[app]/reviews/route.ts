import { currentUser, parseNum, route } from '@/server/http';
import { applicantReviews } from '@/server/shifts';

/** Отзывы об откликнувшемся — для работодателя заказа. */
export async function GET(req: Request, ctx: { params: Promise<{ num: string; app: string }> }) {
  const { num, app } = await ctx.params;
  return route(async () => applicantReviews(parseNum(num), app, await currentUser()))(req);
}
