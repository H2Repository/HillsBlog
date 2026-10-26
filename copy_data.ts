import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './src/db/schema.ts';
import config from "./firebase-applet-config.json";

const app = initializeApp(config);
const dbFirestore = getFirestore(app, config.firestoreDatabaseId);

const pool = new Pool({
  host: process.env.SQL_HOST,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD,
  database: process.env.SQL_DB_NAME,
});
const dbSql = drizzle(pool, { schema });

async function migrateData() {
  const diarySnap = await getDocs(collection(dbFirestore, "diaries"));
  for (const doc of diarySnap.docs) {
    const d = doc.data();
    await dbSql.execute(`
      INSERT INTO diaries (id, title, content, date, time, lat, lng, region, address, weather, rating, views, has_subcollection_photos)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO NOTHING
    `, [d.id, d.title, d.content, d.date, d.time, d.location?.lat, d.location?.lng, d.location?.region, d.location?.address, d.weather, d.rating, d.views, d.hasSubcollectionPhotos]);
  }
  console.log("Diaries copied.");
  
  const visitorSnap = await getDocs(collection(dbFirestore, "visitor_logs"));
  for (const doc of visitorSnap.docs) {
    const v = doc.data();
    await dbSql.execute(`
      INSERT INTO visitor_logs (id, timestamp, lat, lng, city, country, region, diary_id, diary_title, device, ip_masked)
      VALUES ($1, to_timestamp($2/1000.0), $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO NOTHING
    `, [v.id, v.timestamp, v.lat, v.lng, v.city, v.country, v.region, v.diaryId, v.diaryTitle, v.device, v.ipMasked]);
  }
  console.log("Visitor logs copied.");
  process.exit(0);
}
migrateData().catch(e => { console.error(e); process.exit(1); });
