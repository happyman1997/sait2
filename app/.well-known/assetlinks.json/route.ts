import { NextResponse } from 'next/server';
import { assetLinks } from '@/server/android';

export const dynamic = 'force-dynamic';

// Связь сайта с Android-приложением (server/android.ts). Приложение не настроено — 404, как и раньше.
export function GET() {
  const links = assetLinks();
  if (!links) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json(links, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
