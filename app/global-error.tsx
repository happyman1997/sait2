'use client';

// Сбой корневого макета: своя страница со своими <html> и <body> (встроенная вставляет <style> без nonce).
import './globals.css';
import sty from './global-error.module.css';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ru">
      <body>
        <main className={sty.c7de79f3}>
          <h1 className={sty.c452fe45}>Что-то пошло не так</h1>
          <p>Арена Работы не открылась. Попробуйте ещё раз через минуту.</p>
          <button className={'btn btn-primary ' + sty.cfd54dbe} onClick={reset}>Попробовать ещё раз</button>
        </main>
      </body>
    </html>
  );
}
