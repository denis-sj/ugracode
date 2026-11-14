import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { DEFAULT_DATABASE_URL } from './pg-store';

const MIGRATION_FILE = fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url));

/** Выполняет идемпотентную миграцию ядра (расширение pgvector, таблицы, индексы, триггер). */
export async function runMigrations(
  connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Promise<void> {
  const sql = await readFile(MIGRATION_FILE, 'utf8');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runMigrations()
    .then(() => {
      console.log('Миграция выполнена');
    })
    .catch((error: unknown) => {
      console.error('Ошибка миграции:', error);
      process.exitCode = 1;
    });
}
