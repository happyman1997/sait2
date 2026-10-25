import type { Me } from '@/components/app/Live';
import type { SessionUser } from './session';

/** Данные вошедшего пользователя для клиентской оболочки. */
export function meOf(u: SessionUser | null): Me {
  return u && {
    // В шапке — место из «Моей базы» (без региона): город из регистрации после смены базы устаревает.
    id: u.id, name: u.name, role: u.role, city: u.base_lat != null && u.base_label ? u.base_label.split(',')[0] : u.city, avatarUrl: u.avatar_url,
    baseLat: u.base_lat, baseLng: u.base_lng, baseLabel: u.base_label || u.city, isStaff: u.is_staff
  };
}
