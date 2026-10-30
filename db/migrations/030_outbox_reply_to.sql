-- Письма поддержке (жалобы, споры): «Ответить» в почте пишет автору обращения, а не на адрес сайта.
ALTER TABLE notification_outbox ADD COLUMN reply_to text;
