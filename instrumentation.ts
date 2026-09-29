// Next.js вызывает register() при старте сервера. Планировщик нужен только в Node-рантайме:
// импорт внутри условия по NEXT_RUNTIME вырезается из edge-сборки (иначе туда попал бы pg).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
