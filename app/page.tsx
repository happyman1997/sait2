import { AppHeader } from '@/components/AppHeader';
import { css } from '@/lib/css';
import { currentUser } from '@/server/http';

export const dynamic = 'force-dynamic';

// Главная — карта заказов. Карта, лента и фильтры — следующий этап (CRUD заказов + гео-поиск).
export default async function Home() {
  const u = await currentUser();
  return (
    <div style={css('display: flex; flex-direction: column; min-height: 100vh')}>
      <AppHeader me={u && { name: u.name, role: u.role, city: u.city }} />
      <main style={css('flex: 1; display: grid; place-items: center; padding: 24px 16px')}>
        <div className="blueprint" style={css('max-width: 560px; width: 100%; padding: 22px 24px; background: var(--color-neutral-100)')}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div style={css('font-family: var(--font-heading); font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 62%, transparent)')}>Карта заказов</div>
          <h2 style={css('margin: 4px 0 8px; font-size: 26px; text-transform: uppercase')}>{u ? 'Кабинет ' + (u.role === 'employer' ? 'работодателя' : 'исполнителя') : 'Сезонная работа рядом'}</h2>
          <p style={css('font-size: 14.5px; line-height: 1.55; color: color-mix(in srgb, var(--color-text) 75%, transparent); margin: 0')}>
            Карта со сменами, лента и фильтры подключаются на следующем этапе. Регистрация, вход и восстановление доступа уже работают.
          </p>
        </div>
      </main>
    </div>
  );
}
