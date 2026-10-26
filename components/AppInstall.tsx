'use client';

// Сайт как приложение на телефоне (app/manifest.ts): регистрация Service Worker на каждой странице, кнопка
// «Установить» там, где браузер её даёт (Android, Chrome), и шаги «На экран „Домой“» для iPhone — там кнопки нет.
import { useEffect, useState, useSyncExternalStore } from 'react';
import sty from './AppInstall.module.css';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
export type InstallMode = 'installed' | 'prompt' | 'ios' | 'android' | 'none';

const EV = 'arena:install';
// Событие браузера «можно установить» приходит один раз за загрузку страницы — держим его до нажатия кнопки.
let deferred: InstallPrompt | null = null;
const changed = () => window.dispatchEvent(new Event(EV));

/** В корневом layout: Service Worker (пуш, страница «Нет интернета») и событие «можно установить». */
export function ServiceWorkerSetup() {
  useEffect(() => {
    const onPrompt = (e: Event) => { deferred = e as InstallPrompt; changed(); };
    const onInstalled = () => { deferred = null; changed(); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* без воркера сайт работает, только без пуша */ });
    }
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  return null;
}

const STANDALONE = '(display-mode: standalone)';
function detect(): InstallMode {
  if (window.matchMedia(STANDALONE).matches || (navigator as { standalone?: boolean }).standalone) return 'installed';
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  // iPad с iPadOS представляется компьютером Mac — отличаем по сенсорному экрану.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'none';
}
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(STANDALONE);
  window.addEventListener(EV, cb); m.addEventListener('change', cb);
  return () => { window.removeEventListener(EV, cb); m.removeEventListener('change', cb); };
};

export function useInstall() {
  const mode = useSyncExternalStore(subscribe, detect, () => 'none' as InstallMode);
  const install = async () => {
    const e = deferred;
    if (!e) return false;
    deferred = null;
    await e.prompt();
    const { outcome } = await e.userChoice;
    changed();
    return outcome === 'accepted';
  };
  return { mode, install };
}

// Значок «Поделиться» из Safari — по нему его и узнают.
const ShareIcon = () => (
  <svg className={sty.icon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="«Поделиться»">
    <path d="M12 3v12M8 7l4-4 4 4" /><path d="M7 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
  </svg>
);

/** Как установить вручную: iPhone (Safari) и Android-браузеры без кнопки «Установить». */
export function InstallSteps({ mode }: { mode: 'ios' | 'android' }) {
  return mode === 'ios' ? (
    <ol className={sty.steps}>
      <li>Внизу экрана Safari нажмите <ShareIcon /> «Поделиться».</li>
      <li>Выберите «На экран „Домой“» — пункт ниже в списке.</li>
      <li>Нажмите «Добавить». Иконка «Арена Работ» появится на экране телефона.</li>
    </ol>
  ) : (
    <ol className={sty.steps}>
      <li>Откройте меню браузера — <b>⋮</b> или <b>≡</b> в углу экрана.</li>
      <li>Выберите «Установить приложение» или «Добавить на главный экран».</li>
    </ol>
  );
}

type Phone = 'android' | 'ios';
const detected = (mode: InstallMode): Phone | null => (mode === 'ios' ? 'ios' : mode === 'android' || mode === 'prompt' ? 'android' : null);
const COARSE = '(pointer: coarse)';
const useTouch = () => useSyncExternalStore(() => () => {}, () => window.matchMedia(COARSE).matches, () => false);

/**
 * Выбор телефона — «Android» или «iPhone» — и как установить на нём. Свой телефон подсвечен (если узнали), другой —
 * одним нажатием. На Android с кнопкой браузера — сразу «Установить приложение», шаги через меню — запасной путь.
 */
function InstallChooser({ preselect, note }: { preselect: boolean; note?: boolean }) {
  const { mode, install } = useInstall();
  const touch = useTouch();
  const [pick, setPick] = useState<Phone | null>(null);
  // На компьютере свой телефон не угадать — ждём выбора.
  const phone = pick ?? (preselect && touch ? detected(mode) : null);
  // Кнопка браузера на компьютере поставила бы приложение на компьютер — там только шаги для телефона.
  const canPrompt = mode === 'prompt' && touch;
  const choose = (p: Phone) => {
    // Android с кнопкой браузера: выбор «Android» в карточке — сразу системное окно установки.
    if (p === 'android' && canPrompt && !preselect) void install();
    setPick(p);
  };
  return (
    <div>
      <div className={sty.pick} role="group" aria-label="Какой у вас телефон">
        {(['android', 'ios'] as const).map(p => (
          <button key={p} type="button" aria-pressed={phone === p} className={'btn ' + (phone === p ? 'btn-primary ' : 'btn-secondary ') + sty.pickBtn} onClick={() => choose(p)}>
            {p === 'android' ? 'Android' : 'iPhone'}
          </button>
        ))}
      </div>
      {phone && !touch && <div className={sty.note}>Откройте {typeof window === 'undefined' ? 'сайт' : window.location.host} на телефоне и:</div>}
      {phone === 'android' && canPrompt && (
        <>
          <button className={'btn btn-primary ' + sty.cta + ' ' + sty.install} onClick={() => { void install(); }}>Установить приложение</button>
          <div className={sty.note}>Или вручную, через меню браузера:</div>
        </>
      )}
      {phone && <InstallSteps mode={phone} />}
      {phone === 'ios' && note && <div className={sty.note}>На iPhone уведомления приходят только в установленном приложении: откройте его с экрана «Домой» и включите пуш: «Настройки» вверху профиля → «Оповещения».</div>}
    </div>
  );
}

// Карточка на главной: один раз «×» — не показываем 60 дней (запоминается в браузере).
const HIDE_KEY = 'arena.installHidden';
const HIDE_DAYS = 60;
const readHidden = () => { try { return Date.now() - Number(localStorage.getItem(HIDE_KEY) || 0) < HIDE_DAYS * 86400_000; } catch { return false; } };
const onHide = (cb: () => void) => { window.addEventListener(EV, cb); return () => window.removeEventListener(EV, cb); };

/** Предложение установить на главной — вошедшим, на телефоне, пока не установлено: выбор Android / iPhone. */
export function InstallCard() {
  const { mode } = useInstall();
  const hidden = useSyncExternalStore(onHide, readHidden, () => true);
  const touch = useTouch();
  if (hidden || !touch || mode === 'installed') return null;
  const hide = () => { try { localStorage.setItem(HIDE_KEY, String(Date.now())); } catch { /* приватный режим */ } changed(); };
  return (
    <section className={sty.card} aria-label="Приложение на телефон">
      <button className={sty.close} onClick={hide} aria-label="Скрыть">×</button>
      <div className={sty.title}>Приложение на телефон</div>
      <div className={sty.text}>Иконка на экране, открывается без браузера, уведомления о сменах и откликах приходят как в приложении. Какой у вас телефон?</div>
      <InstallChooser preselect={false} />
    </section>
  );
}

/** Раздел профиля: выбор Android / iPhone (свой — подсвечен) и как установить; в самом приложении — «установлено». */
export function InstallBlock() {
  const { mode } = useInstall();
  if (mode === 'installed') return <div className={sty.done}>Приложение установлено — вы сейчас в нём.</div>;
  return <InstallChooser preselect note />;
}
