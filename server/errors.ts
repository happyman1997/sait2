import type { BadCategory } from '@/lib/moderation';

// Ошибка для пользователя: текст показывается как есть, field — какое поле подсветить.
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
  }
}

export class ModerationError extends AppError {
  constructor(field: string, public label: string, public category: BadCategory) {
    super(422, `Поле «${label}»: так написать нельзя (${category}).`, field, { moderation: { label, category } });
  }
}
