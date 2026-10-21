// «Поделиться» заказом: текст и ссылки для мессенджеров — работодатель разносит заказ по чатам дома и района.
import { dateLabel, money } from './jobs';

/** Одна строка о заказе — то же, что на картинке-превью: что, сколько, где, когда. */
export function shareText(j: { title: string; pay: number; unit: string; address: string; date: string; repeat: string | null }): string {
  return j.title + ' — ' + money(j.pay, j.unit) + ' · ' + j.address + ' · ' + (j.repeat ? 'с ' : '') + dateLabel(j.date);
}

/** Ссылки «поделиться» сервисов: открывают выбор чата с готовым сообщением, превью мессенджер строит сам. */
export function shareLinks(url: string, text: string): { id: 'tg' | 'wa' | 'vk'; label: string; href: string }[] {
  const u = encodeURIComponent(url);
  return [
    { id: 'tg', label: 'Telegram', href: 'https://t.me/share/url?url=' + u + '&text=' + encodeURIComponent(text) },
    { id: 'wa', label: 'WhatsApp', href: 'https://wa.me/?text=' + encodeURIComponent(text + '\n' + url) },
    { id: 'vk', label: 'ВКонтакте', href: 'https://vk.com/share.php?url=' + u + '&title=' + encodeURIComponent(text) }
  ];
}
