'use client';

// Яндекс Метрика (lib/metrika.ts): полоса «Разрешить статистику?» до решения посетителя, счётчик — только после
// «Разрешить», просмотры при переходах внутри сайта, цель «приложение установлено». Решение меняют в политике (StatsSwitch).
// Полоса — над страницей, в её потоке: ничего не закрывает, а экраны во весь рост (карта, вход) становятся ниже
// на её высоту — она в переменной --consent-h.
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { STATS_EVENT, cleanUrl, forgetMetrika, goal, hit, rememberLanding, setStatsChoice, startMetrika, statsChoice, type StatsChoice } from '@/lib/metrika';
import sty from './Analytics.module.css';

const subscribe = (cb: () => void) => { window.addEventListener(STATS_EVENT, cb); return () => window.removeEventListener(STATS_EVENT, cb); };
// На сервере решения не знаем — окно не рисуем (его нет и в HTML для поисковиков).
const useChoice = () => useSyncExternalStore<StatsChoice | 'server'>(subscribe, statsChoice, () => 'server');

export function Analytics({ id }: { id: number }) {
  const choice = useChoice();
  const pathname = usePathname();
  const search = useSearchParams();
  const last = useRef('');
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    rememberLanding();
    const installed = () => goal('app_installed');
    window.addEventListener('appinstalled', installed);
    return () => window.removeEventListener('appinstalled', installed);
  }, []);

  useEffect(() => {
    if (choice === 'yes' && !last.current) last.current = startMetrika(id);
  }, [choice, id]);

  useEffect(() => {
    if (!last.current) return;
    const here = cleanUrl(location.href);
    if (here === last.current) return;
    hit(here, last.current);
    last.current = here;
  }, [pathname, search]);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement.style;
    const set = () => root.setProperty('--consent-h', el.offsetHeight + 'px');
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => { ro.disconnect(); root.removeProperty('--consent-h'); };
  }, [choice]);

  if (choice !== null) return null;
  return (
    <section ref={bar} className={sty.banner} aria-label="Статистика посещений">
      <p className={sty.text}>
        Разрешите статистику посещений: Яндекс Метрика ставит cookie и передаёт ООО «Яндекс» IP-адрес и сведения
        о посещении. <Link href="/legal/personal-data#stats">Подробнее</Link>
      </p>
      <div className={sty.actions}>
        <button className="btn btn-primary" onClick={() => setStatsChoice('yes')}>Разрешить</button>
        <button className="btn btn-secondary" onClick={() => setStatsChoice('no')}>Нет</button>
      </div>
    </section>
  );
}

/** Политика, раздел 3: разрешена ли статистика в этом браузере, и кнопка, чтобы передумать. */
export function StatsSwitch() {
  const choice = useChoice();
  if (choice === 'server') return null;
  const off = () => {
    setStatsChoice('no');
    // Запущенный счётчик из страницы не выгрузить — перезагрузка, теперь уже без него.
    if (forgetMetrika()) location.reload();
  };
  return (
    <span className={sty.switch}>
      {choice === 'yes' ? 'Сейчас в этом браузере статистика разрешена.' : 'Сейчас в этом браузере статистика не разрешена.'}
      {choice === 'yes'
        ? <button className="btn btn-secondary" onClick={off}>Запретить</button>
        : <button className="btn btn-secondary" onClick={() => setStatsChoice('yes')}>Разрешить</button>}
    </span>
  );
}
