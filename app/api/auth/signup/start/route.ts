import { cookies } from 'next/headers';
import { startSignup } from '@/server/auth';
import { assertSameOrigin, readJson, requestCtx, route } from '@/server/http';
import { pool } from '@/server/db';
import { NONCE_COOKIE } from '@/server/oauth';

export const POST = route(async (req) => {
  await assertSameOrigin(req);
  // После «Войти через…» анкета несёт билет; он действует только в браузере, начавшем вход (cookie).
  return startSignup(await readJson(req), await requestCtx(), pool(), (await cookies()).get(NONCE_COOKIE)?.value);
});
