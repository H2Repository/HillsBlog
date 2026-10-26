import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './src/db/schema.ts';

const pool = new Pool({
  host: process.env.SQL_HOST,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
  database: process.env.SQL_DB_NAME,
  max: 1,
});

const db = drizzle(pool, { schema });

async function migrate() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS diaries (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      lat TEXT,
      lng TEXT,
      region TEXT,
      address TEXT,
      weather TEXT,
      rating INTEGER,
      views INTEGER DEFAULT 0,
      has_subcollection_photos BOOLEAN,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS visitor_logs (
      id TEXT PRIMARY KEY,
      timestamp TIMESTAMP NOT NULL,
      lat TEXT,
      lng TEXT,
      city TEXT,
      country TEXT,
      region TEXT,
      diary_id TEXT,
      diary_title TEXT,
      device TEXT,
      ip_masked TEXT
    );
  `);
  console.log("Tables created successfully.");
  process.exit(0);
}
migrate().catch(e => { console.error(e); process.exit(1); });
