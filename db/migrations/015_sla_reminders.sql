-- Напоминания поддержке о сроке ответа: 0 — не напоминали, 1 — «срок истекает в течение суток», 2 — «срок прошёл».
ALTER TABLE complaints ADD COLUMN sla_stage smallint NOT NULL DEFAULT 0;
ALTER TABLE disputes ADD COLUMN sla_stage smallint NOT NULL DEFAULT 0;
