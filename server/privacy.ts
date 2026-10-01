// Объект частного заказчика — обычно его дом. До найма точный адрес не раскрывается (распространение ПДн, ст. 10.1 152-ФЗ):
// в выдаче и карточке — улица без номера дома и точка, сдвинутая на 150–350 м. Сдвиг детерминирован по id заказа —
// одна и та же точка при каждом запросе, усреднением её не вычислить.
import { createHash } from 'node:crypto';

export const PRIVATE_ORG = 'частное лицо';
export const PRIVATE_NAME = 'Частный заказчик';
export const isPrivateOrg = (orgType: string | null | undefined) => (orgType || PRIVATE_ORG) === PRIVATE_ORG;

/** «Москва, ул. Тверская, 18, кв. 5» → «Москва, ул. Тверская»: части с цифрами (дом, корпус, квартира) убираются. */
export function roughAddress(address: string, district: string | null): string {
  const kept = address.split(',').map(s => s.trim()).filter(s => s && !/\d/.test(s));
  return kept.join(', ') || district || 'Адрес откроется после найма';
}

export function fuzzPoint(id: string, lat: number, lng: number): { lat: number; lng: number } {
  const h = createHash('sha256').update('pt:' + id).digest();
  const angle = (h.readUInt32BE(0) / 0x1_0000_0000) * 2 * Math.PI;
  const meters = 150 + (h.readUInt32BE(4) / 0x1_0000_0000) * 200;
  const dLat = (meters * Math.cos(angle)) / 111_320;
  const dLng = (meters * Math.sin(angle)) / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { lat: lat + dLat, lng: lng + dLng };
}

export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}
