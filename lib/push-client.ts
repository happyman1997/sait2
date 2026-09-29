'use client';

// Веб-пуш в браузере: регистрация Service Worker и подписка с ключом VAPID сервера.
import { api } from './api';

export type PushState = 'unsupported' | 'off-server' | 'denied' | 'off' | 'on';

const supported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(b64: string) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const { key } = await api<{ key: string | null }>('/api/me/push');
  if (!key) return 'off-server';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const { key } = await api<{ key: string | null }>('/api/me/push');
  if (!key) return 'off-server';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api('/api/me/push', { subscription: sub.toJSON() });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const sub = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
  if (sub) {
    await api('/api/me/push', { endpoint: sub.endpoint }, 'DELETE');
    await sub.unsubscribe();
  }
  return 'off';
}
