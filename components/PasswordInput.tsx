'use client';

// Поле пароля с кнопкой «показать»: на телефоне пароль легко набрать с опечаткой вслепую.
import { useState, type InputHTMLAttributes } from 'react';
import sty from './PasswordInput.module.css';

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <span className={sty.wrap}>
      <input {...props} type={shown ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} data-nomod="" />
      <button type="button" className={sty.eye} onClick={() => setShown(v => !v)} aria-pressed={shown} aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}>
        {shown ? 'скрыть' : 'показать'}
      </button>
    </span>
  );
}
