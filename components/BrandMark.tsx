import { MARK_PATH, MARK_VIEWBOX } from '@/lib/brand';

/** Знак площадки (lib/brand.ts); цвет — currentColor. */
export function BrandMark({ width, height = width }: { width: number | string; height?: number | string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} width={width} height={height} aria-hidden="true">
      <path fill="currentColor" d={MARK_PATH} />
    </svg>
  );
}
