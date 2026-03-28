// Run SQL migrations in order from the migrations/ directory at the repo root.
// Safe to re-run: tracks applied migrations in _migrations table.
// If objects already exist (e.g. from Docker init scripts), marks migration applied and continues.
// Usage: pnpm --filter api db:migrate
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
// migrations/ is at the repo root — 4 levels up from src/db/
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', '..', 'migrations');

// PostgreSQL error codes that indicate the object already exists (idempotent ignore)
const ALREADY_EXISTS_CODES = new Set([
  '42710', // duplicate_object (type/function)
  '42P07', // duplicate_table
  '42P16', // invalid_table_definition (sometimes from duplicate)
  '42701', // duplicate_column
]);

async function migrate(): Promise<void> {
  const DATABASE_URL = process.env['DATABASE_URL'];
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const sql = postgres(DATABASE_URL, { max: 1 });

  try {
    // Ensure migrations tracking table exists
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id        SERIAL PRIMARY KEY,
        filename  TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await sql`
        SELECT 1 FROM _migrations WHERE filename = ${file}
      `;
      if (applied.length > 0) {
        console.log(`  skip  ${file}`);
        continue;
      }

      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await sql.unsafe(content);
      } catch (err: unknown) {
        // If the object already exists (e.g. created by Docker init scripts),
        // mark the migration as applied and continue rather than failing.
        const pgErr = err as { code?: string };
        if (pgErr.code && ALREADY_EXISTS_CODES.has(pgErr.code)) {
          console.log(`  mark  ${file} (objects already existed: code ${pgErr.code})`);
        } else {
          throw err;
        }
      }

      await sql`INSERT INTO _migrations (filename) VALUES (${file}) ON CONFLICT DO NOTHING`;
      console.log(`  apply ${file}`);
    }

    console.log('Migrations complete.');
  } finally {
    await sql.end();
  }
}

migrate().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
