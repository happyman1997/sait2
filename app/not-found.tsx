import Link from 'next/link';
import { LegalPage } from '@/components/LegalPage';
import sty from './not-found.module.css';

// Своя страница 404: встроенная страница Next.js вставляет тег <style> без nonce — строгая CSP его не пропустит.
export const metadata = { title: 'Страница не найдена — Арена Работы' };

export default function NotFound() {
  return (
    <LegalPage kicker="Ошибка 404" title="Страница не найдена">
      <p>Такой страницы нет — возможно, ссылка устарела или заказ снят с публикации.</p>
      <p className={sty.caea80b7}>
        <Link href="/" className={'btn btn-primary ' + sty.c51c739b}>К карте смен</Link>
        <Link href="/mine" className={'btn btn-secondary ' + sty.c51c739b}>Мои смены и заказы</Link>
      </p>
    </LegalPage>
  );
}
