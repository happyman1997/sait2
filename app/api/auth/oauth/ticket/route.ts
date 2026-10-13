import { cookies } from 'next/headers';
import { route } from '@/server/http';
import { NONCE_COOKIE, ticketInfo } from '@/server/oauth';

/** Данные от Яндекс ID / VK ID для анкеты регистрации (по одноразовому билету, только в том же браузере). */
export const GET = route(async (req) => ticketInfo(new URL(req.url).searchParams.get('t'), (await cookies()).get(NONCE_COOKIE)?.value));
