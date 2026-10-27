-- Посты сайта в Telegram-канал (server/channel.ts): сводка заказов — одна за день, даже при нескольких экземплярах
-- приложения. Строка «занимает» день до отправки; message_id пустой — в этот день публиковать было нечего.
CREATE TABLE channel_posts (
  kind       text NOT NULL,
  day        date NOT NULL,
  message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, day)
);
