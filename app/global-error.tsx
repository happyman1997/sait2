'use client';

// Сбой корневого макета: своя страница со своими <html> и <body> (встроенная вставляет <style> без nonce).
import './globals.css';
import { css } from '@/lib/css';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ru">
      <body>
        <main style={css('max-width: 560px; margin: 0 auto; padding: 48px 16px; font-size: 15px; line-height: 1.6')}>
          <h1 style={css('font-size: 26px; text-transform: uppercase; letter-spacing: .02em')}>Что-то пошло не так</h1>
          <p>Арена Работы не открылась. Попробуйте ещё раз через минуту.</p>
          <button className="btn btn-primary" onClick={reset} style={css('height: 42px; padding: 0 18px')}>Попробовать ещё раз</button>
        </main>
      </body>
    </html>
  );
}
