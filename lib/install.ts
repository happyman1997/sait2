// Сайт как приложение: событие браузера «можно установить» (beforeinstallprompt) приходит один раз за загрузку
// страницы, бывает — раньше, чем страница оживёт. Его ловит этот скрипт в <head> (app/layout.tsx) и держит в
// window.__arenaInstall до нажатия кнопки «Установить» (components/AppInstall.tsx).
export const INSTALL_EVENT = 'arena:install';
export const INSTALL_CATCHER =
  "addEventListener('beforeinstallprompt',function(e){window.__arenaInstall=e;dispatchEvent(new Event('" + INSTALL_EVENT + "'))});" +
  "addEventListener('appinstalled',function(){window.__arenaInstall=null;dispatchEvent(new Event('" + INSTALL_EVENT + "'))});";
