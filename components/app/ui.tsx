'use client';

// Общие кусочки интерфейса прототипа: уголки blueprint, чипы, подписи, стили ошибок.
import type { ReactNode } from 'react';
import { css } from '@/lib/css';

export const Corners = () => <><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>;

export function Chip({ active, onClick, children, extra = '' }: { active: boolean; onClick: () => void; children: ReactNode; extra?: string }) {
  return (
    <button type="button" className={'tag ' + (active ? 'tag-accent' : 'tag-outline')} onClick={onClick} aria-pressed={active}
      style={css('cursor: pointer; border-width: 1px; border-style: solid; ' + extra)}>{children}</button>
  );
}

export const LABEL = 'font-family: var(--font-heading); font-size: 12.5px; letter-spacing: .2em; text-transform: uppercase; color: color-mix(in srgb, var(--color-text) 64%, transparent)';
export const MUTED = 'color: color-mix(in srgb, var(--color-text) 66%, transparent)';
export const ALERT = 'font-size: 13.5px; font-weight: 600; line-height: 1.4; margin-top: 16px; color: var(--color-accent-900); border: 2px solid var(--color-accent-700); padding: 9px 11px; background: var(--color-accent-100)';
export const FIELD_ERR = 'font-size: 13px; line-height: 1.4; margin-top: 5px; color: var(--color-accent-900); font-weight: 600';

export const errFieldStyle = 'border: 2px solid var(--color-accent-700); background: var(--color-accent-100); box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 30%, transparent); animation: missGlow 1.1s ease-in-out 4';

export function optStyle(active: boolean) {
  return 'min-width: 0; box-sizing: border-box; cursor: pointer; text-align: left; padding: 9px 11px; font-family: var(--font-heading); font-size: 14px; letter-spacing: .04em; text-transform: uppercase; border: 1px solid ' +
    (active ? 'var(--color-accent)' : 'var(--color-divider)') + '; background: ' + (active ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : 'transparent') +
    '; color: ' + (active ? 'var(--color-accent-900)' : 'var(--color-text)') + '; display: flex; justify-content: space-between; gap: 10px';
}

export function initialsOf(name: string) {
  return String(name || '').replace(/[^А-Яа-яЁёA-Za-z ]/g, '').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
}
