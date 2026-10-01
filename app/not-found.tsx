import Link from 'next/link';
import { LegalPage } from '@/components/LegalPage';
import { css } from '@/lib/css';

// Своя страница 404: встроенная страница Next.js вставляет тег <style> без nonce — строгая CSP его не пропустит.
export const metadata = { title: 'Страница не найдена — Арена Работы' };

export default function NotFound() {
  return (
    <LegalPage kicker="Ошибка 404" title="Страница не найдена">
      <p>Такой страницы нет — возможно, ссылка устарела или заказ снят с публикации.</p>
      <p style={css('display: flex; gap: 8px; flex-wrap: wrap')}>
        <Link href="/" className="btn btn-primary" style={css('height: 42px; padding: 0 18px; display: inline-flex; align-items: center; text-decoration: none')}>К карте смен</Link>
        <Link href="/mine" className="btn btn-secondary" style={css('height: 42px; padding: 0 18px; display: inline-flex; align-items: center; text-decoration: none')}>Мои смены и заказы</Link>
      </p>
    </LegalPage>
  );
}
