-- Как часто повторяется заказ — частотой выходов, без «графика» и «ежедневно»: это договор по заказу, а не режим
-- работы (lib/catalog.ts REPEATS). Даты серии от названия не зависят — шаблоны в seriesDates понимают оба варианта.
UPDATE jobs SET repeat = 'каждый день до конца сезона' WHERE repeat = 'ежедневно до конца сезона';
UPDATE jobs SET repeat = 'по будням' WHERE repeat = 'ежедневно, будни';
UPDATE jobs SET repeat = 'два дня через два' WHERE repeat = 'график 2/2';
