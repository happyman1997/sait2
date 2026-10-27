// Яндекс Метрика: в адресах — только метки рекламы и номер заказа; цели — по успешным ключевым запросам.
import { describe, expect, it } from 'vitest';
import { goalOf } from '@/lib/api';
import { cleanReferrer, cleanUrl } from '@/lib/metrika';

describe('Метрика: адреса страниц', () => {
  it('служебные параметры (билет входа, режим формы) убираются, метки рекламы и номер заказа остаются', () => {
    expect(cleanUrl('https://arenarabot.ru/auth?mode=signup&oauth=SECRET-TICKET&utm_source=avito&utm_campaign=moskva')).toBe('https://arenarabot.ru/auth?utm_source=avito&utm_campaign=moskva');
    expect(cleanUrl('https://arenarabot.ru/?job=12&apply=1&yclid=777#x')).toBe('https://arenarabot.ru/?job=12&yclid=777');
    expect(cleanUrl('https://arenarabot.ru/profile?email=ok')).toBe('https://arenarabot.ru/profile');
    expect(cleanUrl('не адрес')).toBe('');
  });

  it('откуда пришли: чужой сайт — как есть, свой — без служебных параметров', () => {
    expect(cleanReferrer('https://yandex.ru/search/?text=уборка', 'https://arenarabot.ru')).toBe('https://yandex.ru/search/?text=уборка');
    expect(cleanReferrer('https://arenarabot.ru/auth?oauth=T', 'https://arenarabot.ru')).toBe('https://arenarabot.ru/auth');
    expect(cleanReferrer('', 'https://arenarabot.ru')).toBe('');
  });
});

describe('Метрика: цели', () => {
  it('регистрация — по роли, заказ, отклик, найм; остальное и не POST — не цель', () => {
    expect(goalOf('/api/auth/signup/verify', 'POST', { user: { role: 'employer' } })).toBe('signup_employer');
    expect(goalOf('/api/auth/oauth/signup', 'POST', { user: { role: 'freelancer' } })).toBe('signup_freelancer');
    expect(goalOf('/api/jobs', 'POST', {})).toBe('job_created');
    expect(goalOf('/api/jobs/12', 'PATCH', {})).toBeNull();
    expect(goalOf('/api/jobs/12/apply', 'POST', {})).toBe('apply');
    expect(goalOf('/api/jobs/12/applicants/3f2a/hire', 'POST', {})).toBe('hire');
    expect(goalOf('/api/jobs/12/withdraw', 'POST', {})).toBeNull();
    expect(goalOf('/api/auth/login', 'POST', { user: { role: 'employer' } })).toBeNull();
  });
});
