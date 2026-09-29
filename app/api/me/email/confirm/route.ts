import { NextResponse } from 'next/server';
import { config } from '@/server/config';
import { route } from '@/server/http';
import { confirmEmail } from '@/server/verify';

// Переход по ссылке из письма: подтверждаем и ведём в профиль с итогом.
export const GET = route(async (req) => {
  const ok = await confirmEmail(new URL(req.url).searchParams.get('t'));
  return NextResponse.redirect(config.publicUrl() + '/profile?email=' + (ok ? 'ok' : 'bad'), 303);
});
