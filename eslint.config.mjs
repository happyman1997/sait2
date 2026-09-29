import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';

const config = [
  ...next,
  ...ts,
  { ignores: ['.next/**', 'node_modules/**', 'design/**', 'data/**', 'next-env.d.ts', 'public/sw.js'] },
  {
    rules: {
      // Фото — пользовательские (аватары, фото смены) с защищённого маршрута; next/image здесь не даёт выигрыша.
      '@next/next/no-img-element': 'off',
      // Загрузка данных при монтировании и сброс состояния по смене свойства — осознанные; оставляем подсказкой.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
];

export default config;
