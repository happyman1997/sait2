import { NextResponse } from 'next/server';
import { clickAd } from '@/server/ads';
import { route } from '@/server/http';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return route(async () => NextResponse.redirect(await clickAd(id), 302))(req);
}
