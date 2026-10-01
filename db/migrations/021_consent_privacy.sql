-- Согласие на обработку ПДн — отдельно от оферты (ч. 1 ст. 9 152-ФЗ в редакции с 01.09.2025): своя галочка, своя дата и редакция.
ALTER TABLE users ADD COLUMN pd_consent_at timestamptz;
ALTER TABLE users ADD COLUMN pd_consent_version text;

-- Невыходы за последний год — работодателям в откликах (Правила площадки).
CREATE INDEX no_shows_freelancer_idx ON no_shows (freelancer_id, at);
