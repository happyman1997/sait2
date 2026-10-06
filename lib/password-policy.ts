// Требования к новому паролю — общие для сервера и форм. Вход старым паролем проверяет только сервер, по хэшу.
// Самые частые пароли подбирают первыми — их не принимаем, как и логин или номер телефона вместо пароля.
export const PASSWORD_MIN = 8;

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344', '12121212',
  'password', 'password1', 'qwertyui', 'qwerty123', 'qwerty12', 'qwertyuiop', '1q2w3e4r', '1q2w3e4r5t', '1qaz2wsx',
  'zaq12wsx', 'asdfghjk', 'zxcvbnm1', 'iloveyou', 'abcd1234', 'abc12345', 'q1w2e3r4', 'aaaaaaaa', 'йцукенгш',
  'пароль12', 'qwertyqwerty', 'samsung1', 'admin123', 'marina12', 'natasha1', 'dragon12', 'monkey12', 'football',
  'superman', 'sunshine', 'princess', 'starwars', 'whatever', 'trustno1', 'baseball', 'master12', 'letmein1'
]);

/** Текст ошибки или null, если пароль подходит. */
export function passwordProblem(pw: string, ctx: { login?: string; phone?: string } = {}): string | null {
  if (pw.length < PASSWORD_MIN) return 'Пароль — не короче ' + PASSWORD_MIN + ' символов.';
  if (pw.length > 128) return 'Пароль длиннее 128 символов — сократите.';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw) || '01234567890123456789'.includes(pw) || '98765432109876543210'.includes(pw)) {
    return 'Этот пароль в списке самых частых — его подбирают первым. Придумайте другой.';
  }
  const digits = (ctx.phone || '').replace(/\D/g, '');
  if ((ctx.login && low === ctx.login.toLowerCase()) || (digits.length >= 10 && pw.replace(/\D/g, '').endsWith(digits.slice(-10)) && /^\+?\d+$/.test(pw))) {
    return 'Логин или номер телефона вместо пароля угадают сразу — придумайте другой.';
  }
  return null;
}
