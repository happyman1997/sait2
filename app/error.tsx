'use client';

// Ошибка внутри раздела: своя страница вместо встроенной (та вставляет <style> без nonce).
import { LegalPage } from '@/components/LegalPage';
import sty from './error.module.css';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <LegalPage kicker="Сбой" title="Что-то пошло не так">
      <p>Страница не открылась. Попробуйте ещё раз — если не поможет, обновите страницу или напишите в поддержку.</p>
      <button className={'btn btn-primary ' + sty.cfd54dbe} onClick={reset}>Попробовать ещё раз</button>
    </LegalPage>
  );
}
