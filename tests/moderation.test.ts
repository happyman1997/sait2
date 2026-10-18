import { describe, expect, it } from 'vitest';
import { badSpan, badWordIn, findBadField, maskBad } from '@/lib/moderation';

// Наборы из истории прототипа (README → «Модерация текста»).
const MUST_CATCH = ['huy', 'blyat', 'suka', 'xyй', 'cyka', 'p1zda', 'Snow_huy', 'Mr.Suka', 'daniyarhuy', 'ivanblyat'];
const MUST_PASS = ['Daniyar', 'Sergey', 'Shurik', 'Snow_Master', 'Pastukhova', 'Sukhov', 'сукно', 'небо', 'вебинар', 'хлебал'];

describe('badWordIn', () => {
  it.each(MUST_CATCH)('ловит «%s»', (w) => {
    expect(badWordIn(w)).not.toBeNull();
  });

  it.each(MUST_PASS)('пропускает «%s»', (w) => {
    expect(badWordIn(w)).toBeNull();
  });

  it.each(['застрахуйте объект', 'нельзя оскорблять людей', 'употреблять реагент по норме', 'Уборка снега во дворе'])(
    'нет ложного срабатывания: «%s»', (w) => {
      expect(badWordIn(w)).toBeNull();
    });

  it('склейка через звёздочки и точки', () => {
    expect(badWordIn('х*й')).toBe('нецензурная лексика');
    expect(badWordIn('б.л.я.д.ь')).toBe('нецензурная лексика');
  });

  it('ник со склеенным корнем', () => {
    expect(badWordIn('суперсука')).toBe('нецензурная лексика');
    expect(badWordIn('snowhuy')).toBe('нецензурная лексика');
  });

  it('категории', () => {
    expect(badWordIn('ты идиот')).toBe('оскорбление');
    expect(badWordIn('Оплата вперёд, потом выход')).toBe('признак мошенничества');
    expect(badWordIn('работа без документов')).toBe('признак мошенничества');
    expect(badWordIn('залог за спецодежду 2000')).toBe('признак мошенничества');
  });

  it('пустые значения', () => {
    expect(badWordIn('')).toBeNull();
    expect(badWordIn(null)).toBeNull();
    expect(badWordIn(undefined)).toBeNull();
  });
});

describe('badSpan / maskBad', () => {
  it('находит слово в фразе', () => {
    const sp = badSpan('Привет, ты сука такая');
    expect(sp.hit).toBe('сука');
    expect(sp.before).toBe('Привет, ты ');
    expect(sp.after).toBe(' такая');
  });

  it('фраза из нескольких слов (мошенничество)', () => {
    expect(badSpan('Нужна оплата вперед за выход').hit).toBe('оплата вперед');
  });

  it('маскирует мат, но не мошенничество', () => {
    expect(maskBad('сука', 'оскорбление')).toBe('с••а');
    expect(maskBad('оплата вперед', 'признак мошенничества')).toBe('оплата вперед');
  });
});

describe('findBadField', () => {
  it('возвращает первое грязное поле, массивы проверяет поэлементно', () => {
    const hit = findBadField([
      { field: 'name', label: 'Имя и фамилия', value: 'Данияр Сапаров' },
      { field: 'customSkills', label: 'Свой навык', value: ['вывоз снега', 'Snow_huy'] }
    ]);
    expect(hit).toEqual({ field: 'customSkills', label: 'Свой навык', category: 'нецензурная лексика' });
  });

  it('null для чистых полей', () => {
    expect(findBadField([{ field: 'city', label: 'Город', value: 'Москва' }])).toBeNull();
  });
});

describe('обходы и новые категории', () => {
  const ZWSP = String.fromCharCode(0x200b), ACUTE = String.fromCharCode(0x301);
  it.each(['Х У Й', 'п и з д е ц', 'с у к а', 'хуууй', 'х' + ZWSP + 'уй', 'пи' + ACUTE + 'здец', 'пізда', 'п!здец', 'бл*дь', 'бл@дь', 'охуеть',
    String.fromCharCode(0xff48, 0xff55, 0xff59)])('мат и оскорбления с обходом: «%s»', w => {
    expect(badWordIn(w)).not.toBeNull();
  });

  it.each(['тварь', 'мразь', 'чмо', 'гнида', 'ублюдок', 'сучара', 'жиды', 'хачи'])('оскорбление «%s»', w => {
    expect(badWordIn(w)).toBe('оскорбление');
  });

  it('дискриминация в объявлении', () => {
    expect(badWordIn('Нужны грузчики, только славяне')).toBe('дискриминация');
    expect(badWordIn('Без мигрантов')).toBe('дискриминация');
    expect(badWordIn('Только граждане РФ с патентом')).toBeNull();
  });

  it('запрещённые товары и услуги', () => {
    for (const w of ['кладмен в Москве', 'делать закладки по городу', 'мефедрон', 'интим услуги', 'эскорт', 'продам оружие', 'купить диплом'])
      expect(badWordIn(w)).toBe('запрещённые товары и услуги');
  });

  it('мошенничество: деньги с исполнителя', () => {
    for (const w of ['внесите залог 3000', 'оплатите обучение', 'переведите на карту за пропуск', 'залог 2000 за форму'])
      expect(badWordIn(w)).toBe('признак мошенничества');
  });

  it.each(['Сучкорез и секатор', 'педикюр', 'героиня', 'Закладка фундамента под баню', 'прокладка кабеля', 'хачапури', 'жидкость для мытья',
    'чмокнуть', 'даунхилл', 'застрахуйте объект', 'страхует', 'сучки на доске', 'переведу на карту после приёмки', 'предоплата 50% исполнителю',
    'художник', 'кухня', 'хуже', 'хутор'])('нет ложного срабатывания: «%s»', w => {
    expect(badWordIn(w)).toBeNull();
  });
});
