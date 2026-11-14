import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { log } from './log';
import { DEFAULT_DATABASE_URL } from './pg-store';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Применяет все SQL-файлы миграций по порядку имён; каждый файл идемпотентен. */
export async function runMigrations(
  connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) {
      const sql = await readFile(`${MIGRATIONS_DIR}${file}`, 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runMigrations()
    .then(() => {
      log('Миграция выполнена');
    })
    .catch((error: unknown) => {
      console.error('Ошибка миграции:', error);
      process.exitCode = 1;
    });
}
