// Проверка почты сайта: вход в ящик на SMTP-сервере и, если указан адрес, тестовое письмо. Пароль не печатается.
// В образе: node scripts/mailcheck.mjs [адрес]; на сервере проще — bash deploy/mailcheck.sh [адрес].
import { mailErrorText, smtpTransport } from '../server/mail';
import { checkMailDns, senderDomain } from '../server/maildns';

/** Что значит ответ почтового сервера и что сделать — простыми словами (ответы Яндекс 360 и типовые сетевые ошибки). */
function advice(e: unknown): string {
  const s = mailErrorText(e);
  // Новые настройки сайт берёт при перезапуске — поэтому после configure.sh сразу launch.sh.
  const fix = `cd ${process.env.APP_DIR || '/opt/arena'} && bash deploy/configure.sh && bash deploy/launch.sh`;
  if (/access rights/i.test(s))
    return 'Ящику запрещены почтовые программы. Войдите в почту этого ящика → Настройки (шестерёнка) → «Почтовые программы» → ' +
      'включите «С сервера imap.yandex.ru по протоколу IMAP» и «Пароли приложений и OAuth-токены», сохраните. Через 5 минут проверьте снова.';
  if (/application password|app password/i.test(s))
    return 'Нужен пароль приложения, а не обычный пароль ящика. Создайте его (тип «Почта») и введите — на всех вопросах Enter, на пароле вставьте новый: ' + fix;
  if (/spam/i.test(s))
    return 'Яндекс придержал отправку из нового ящика как подозрительную. Войдите в этот ящик в браузере, отправьте вручную пару писем ' +
      'себе на другую почту и подождите несколько часов. Если не пройдёт — напишите в поддержку Яндекс 360.';
  if (/not owned|sender address|5\.7\.1.*sender/i.test(s))
    return 'Адрес отправителя (EMAIL_FROM) не совпадает с ящиком, под которым сайт входит в почту. Укажите ящик и пароль к нему заново: ' + fix;
  if (/EAUTH|535|invalid user|authentication failed|invalid login/i.test(s))
    return 'Почта не приняла логин или пароль. Проверьте: 1) в настройках этого ящика, «Почтовые программы», включены IMAP и «Пароли приложений»; ' +
      '2) пароль приложения создан, когда вы вошли в Яндекс именно как этот ящик (не как ваш личный аккаунт), тип — «Почта». ' +
      'Создайте новый и введите его — на всех вопросах Enter, на пароле вставьте новый: ' + fix;
  if (/ENOTFOUND|EAI_AGAIN|EDNS/i.test(s))
    return 'Сервер не нашёл адрес почтового сервера. Проверьте адрес в SMTP_URL (для Яндекса — smtp.yandex.ru) и повторите через пару минут.';
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|ESOCKET|ECONNECTION|EHOSTUNREACH|greeting|timeout/i.test(s))
    return 'Сайт не может связаться с почтовым сервером: похоже, хостинг закрывает исходящую почту. Напишите в поддержку хостинга: ' +
      '«Прошу открыть исходящие соединения на порт 465 (SMTP) к smtp.yandex.ru для сервера ' + (process.env.SERVER_IP || '<IP сервера>') + ' — сайт отправляет письма с кодами через свою почту».';
  if (/not allowed/i.test(s))
    return 'Почтовый сервер не отправляет письма на этот адрес (так у Яндекса с Proton) — сайт такие адреса уже не принимает. Проверьте на Gmail или Mail.ru.';
  if (/recipient|5\.1\.1|mailbox unavailable|no such user/i.test(s))
    return 'Почта отказалась принять письмо для этого адреса получателя — проверьте, что адрес набран без ошибок.';
  return 'Пришлите эти строки — разберёмся.';
}

async function main() {
  const to = (process.argv[2] || '').trim();
  const url = process.env.SMTP_URL || '';
  const from = process.env.EMAIL_FROM || '';
  if (process.env.EMAIL_PROVIDER !== 'smtp' || !url) {
    console.log(`Почта не настроена (нужны EMAIL_PROVIDER=smtp и SMTP_URL) — запустите: cd ${process.env.APP_DIR || '/opt/arena'} && bash deploy/configure.sh && bash deploy/launch.sh`);
    process.exitCode = 1;
    return;
  }
  let user = '?', host = '?', port = '?', pass = '?';
  try {
    const u = new URL(url);
    user = decodeURIComponent(u.username);
    host = u.hostname;
    port = u.port || (u.protocol === 'smtps:' ? '465' : '587');
    // Сам пароль не печатаем — только длину и состав: так видно, что вставилось не то.
    const pw = decodeURIComponent(u.password);
    pass = `${[...pw].length} символов` + (/^[a-zA-Z0-9]+$/.test(pw) ? '' : ', есть пробелы, русские буквы или знаки — похоже, вставилось не то');
  } catch { /* разбор только для подписи; ошибку адреса покажет nodemailer */ }
  console.log(`Ящик: ${user}, сервер: ${host}:${port}, отправитель: ${from || '(не задан)'}`);
  console.log(`Пароль: ${pass}`);

  // Записи домена: без них Gmail, Outlook и другие иностранные почты письма не принимают (на российские при этом доходит).
  const domain = senderDomain(from, user);
  console.log(`— записи домена ${domain || '?'} для доставки на иностранные почты (SPF, DKIM, DMARC)…`);
  const records = await checkMailDns(domain, host);
  for (const c of records) console.log(`  ${c.ok ? 'есть' : 'НЕТ '} ${c.name}: ${c.note}` + (c.fix ? `\n       что сделать: ${c.fix}` : ''));
  const dnsBad = records.some(c => !c.ok && c.fix);

  const t = smtpTransport(url);
  try {
    console.log('— вход в ящик…');
    await t.verify();
    console.log('  вход выполнен');
    if (to) {
      console.log(`— тестовое письмо на ${to}…`);
      await t.sendMail({ from, to, subject: 'Арена Работ: проверка почты', text: 'Это тестовое письмо с сайта. Если вы его видите — письма с кодами тоже дойдут.' });
      console.log('  отправлено. Проверьте «Входящие» и «Спам».');
      console.log(`  Не пришло? Откройте ящик ${user} в браузере: через несколько минут там будет письмо «Недоставленное сообщение» с причиной — пришлите её текст.`);
    }
    if (dnsBad) {
      console.log('\nВход в почту работает, но письма на Gmail, Outlook и другие иностранные почты не дойдут, пока не добавите записи выше.');
      console.log('Записи начинают действовать через 1–24 часа. Потом проверьте на иностранный адрес: bash deploy/mailcheck.sh ваш@gmail.com');
      process.exitCode = 1;
    } else {
      console.log('\nПочта работает.');
    }
  } catch (e) {
    console.log(`  ошибка: ${mailErrorText(e)}`);
    console.log('\nЧто сделать: ' + advice(e));
    process.exitCode = 1;
  } finally {
    t.close();
  }
}

main();
