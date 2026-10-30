import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './src/db/schema.ts';
import { eq } from 'drizzle-orm';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sqlite = new Database('sqlite.db');
const db = drizzle(sqlite, { schema });

// Initialize tables if they don't exist (Simple manual migration for the example)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS diaries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    location TEXT NOT NULL,
    photos TEXT NOT NULL,
    weather TEXT NOT NULL,
    mood_tags TEXT NOT NULL,
    local_insights TEXT NOT NULL,
    rating INTEGER NOT NULL,
    views INTEGER DEFAULT 0,
    has_subcollection_photos INTEGER,
    total_photos_count INTEGER,
    include_in_distance INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS visitor_logs (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
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

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get('/api/diaries', async (req, res) => {
    try {
      const allDiaries = await db.select().from(schema.diaries).all();
      res.json(allDiaries);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/diaries', async (req, res) => {
    try {
      const diary = req.body;
      await db.insert(schema.diaries).values(diary).onConflictDoUpdate({
        target: schema.diaries.id,
        set: diary
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/diaries/:id', async (req, res) => {
    try {
      await db.delete(schema.diaries).where(eq(schema.diaries.id, req.params.id));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/migrate', async (req, res) => {
    try {
      const { diaries: diariesToMigrate } = req.body;
      if (Array.isArray(diariesToMigrate)) {
        for (const d of diariesToMigrate) {
          await db.insert(schema.diaries).values(d).onConflictDoUpdate({
            target: schema.diaries.id,
            set: d
          });
        }
      }
      res.json({ success: true, count: diariesToMigrate.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/diaries/:id/increment-views', async (req, res) => {
    try {
      const diaryId = req.params.id;
      const diary = await db.select().from(schema.diaries).where(eq(schema.diaries.id, diaryId)).get();
      if (diary) {
        await db.update(schema.diaries).set({ views: (diary.views || 0) + 1 }).where(eq(schema.diaries.id, diaryId));
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Diary not found' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/diaries/reset-views', async (req, res) => {
    try {
      await db.update(schema.diaries).set({ views: 0 });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/visitor-logs', async (req, res) => {
    try {
      const logs = await db.select().from(schema.visitorLogs).all();
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/visitor-logs', async (req, res) => {
    try {
      const log = req.body;
      await db.insert(schema.visitorLogs).values(log).onConflictDoUpdate({
        target: schema.visitorLogs.id,
        set: log
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/visitor-logs', async (req, res) => {
    try {
      await db.delete(schema.visitorLogs);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vite middleware
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
