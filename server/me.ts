import type { Me } from '@/components/app/Live';
import type { SessionUser } from './session';

/** Данные вошедшего пользователя для клиентской оболочки. */
export function meOf(u: SessionUser | null): Me {
  return u && {
    id: u.id, name: u.name, role: u.role, city: u.city, avatarUrl: u.avatar_url,
    baseLat: u.base_lat, baseLng: u.base_lng, baseLabel: u.base_label || u.city
  };
}
