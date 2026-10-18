// Координаты города — точка базы нового пользователя: от неё считаются расстояния до заказов, пока он не
// укажет базу точнее в настройках. Только для сервера: тянет за собой весь список городов.
import data from './cities.json';
import { findCity, type City } from './cities';

const CITIES = data.cities as City[];

export function cityPoint(city: string): [number, number] | null {
  const c = findCity(CITIES, city);
  return c ? [c[2], c[3]] : null;
}
