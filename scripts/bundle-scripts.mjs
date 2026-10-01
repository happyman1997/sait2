// Служебные скрипты для Docker-образа: миграции, сотрудники поддержки, cron, реклама — в самодостаточные .mjs
// (dist/scripts), чтобы в образе не нужны были tsx и исходники. Запуск: node scripts/bundle-scripts.mjs
import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/migrate.ts', 'scripts/staff.ts', 'scripts/cron.ts', 'scripts/ads.ts'],
  outdir: 'dist/scripts',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // pg-native — необязательная зависимость pg; require в ESM-сборке — через createRequire.
  external: ['pg-native'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning'
});
console.log('dist/scripts: migrate, staff, cron, ads');
