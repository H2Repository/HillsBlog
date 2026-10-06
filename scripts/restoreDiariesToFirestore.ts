import pg from 'pg';
import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

async function restore() {
  console.log('--- Starting Data Restoration from PostgreSQL to Firestore ---');

  const devEnv = JSON.parse(fs.readFileSync('../.dev.env.json', 'utf8'));
  const cfg = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));

  const app = initializeApp(cfg);
  const db = getFirestore(app, cfg.firestoreDatabaseId);

  const pool = new pg.Pool({
    user: devEnv.SQL_USER,
    password: devEnv.SQL_PASSWORD,
    database: devEnv.SQL_DB_NAME,
    host: devEnv.SQL_HOST,
  });

  const client = await pool.connect();
  const res = await client.query('SELECT * FROM diaries ORDER BY created_at ASC');
  console.log(`Retrieved ${res.rowCount} records from PostgreSQL.`);

  let restoredCount = 0;

  for (const row of res.rows) {
    const diaryDoc = {
      id: String(row.id),
      title: String(row.title || ''),
      content: String(row.content || ''),
      date: String(row.date || ''),
      time: String(row.time || ''),
      location: {
        lat: Number(row.location_lat) || 0,
        lng: Number(row.location_lng) || 0,
        accuracy: row.location_accuracy ? Number(row.location_accuracy) : 0,
        address: String(row.location_address || ''),
        region: String(row.location_region || ''),
        landmark: String(row.location_landmark || ''),
        isRealtimeGps: Boolean(row.location_is_realtime_gps),
      },
      photos: Array.isArray(row.photos) ? row.photos : [],
      weather: String(row.weather || 'sunny'),
      moodTags: Array.isArray(row.mood_tags) ? row.mood_tags : [],
      localInsights: row.local_insights && typeof row.local_insights === 'object' 
        ? row.local_insights 
        : { recommendedForSolo: '' },
      rating: typeof row.rating === 'number' ? row.rating : Number(row.rating) || 5,
      views: typeof row.views === 'number' ? row.views : Number(row.views) || 0,
      createdAt: Number(row.created_at) || Date.now(),
      updatedAt: Number(row.updated_at) || Date.now(),
    };

    const docRef = doc(db, 'diaries', diaryDoc.id);
    await setDoc(docRef, diaryDoc);
    restoredCount++;
    console.log(`[${restoredCount}/${res.rowCount}] Restored: ${diaryDoc.title} (${diaryDoc.id})`);
  }

  client.release();
  await pool.end();

  console.log(`\n Successfully restored all ${restoredCount} diaries to Firestore!`);
  process.exit(0);
}

restore().catch((err) => {
  console.error('Restoration error:', err);
  process.exit(1);
});
