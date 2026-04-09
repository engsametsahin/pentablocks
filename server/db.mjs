import fs from 'node:fs';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required for the API server.');
}

export const pool = new Pool({ connectionString });

export async function ensureSchema() {
  const sql = fs.readFileSync(new URL('./sql/init.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

export async function closePool() {
  await pool.end();
}
