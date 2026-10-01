'use client';

// Ошибка внутри раздела: своя страница вместо встроенной (та вставляет <style> без nonce).
import { LegalPage } from '@/components/LegalPage';
import { css } from '@/lib/css';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <LegalPage kicker="Сбой" title="Что-то пошло не так">
      <p>Страница не открылась. Попробуйте ещё раз — если не поможет, обновите страницу или напишите в поддержку.</p>
      <button className="btn btn-primary" onClick={reset} style={css('height: 42px; padding: 0 18px')}>Попробовать ещё раз</button>
    </LegalPage>
  );
}
