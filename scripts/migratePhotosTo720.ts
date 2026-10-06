import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import fs from 'fs';
import sharp from 'sharp';

interface TravelPhoto {
  id: string;
  url: string;
  caption?: string;
  timestamp?: string;
  isCover?: boolean;
}

interface DiaryEntry {
  id: string;
  title: string;
  photos: TravelPhoto[];
  [key: string]: any;
}

async function migrate() {
  console.log('--- Checking & Migrating Photos to <= 720px ---');
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const app = initializeApp({
    apiKey: config.apiKey,
    projectId: config.projectId,
    authDomain: config.authDomain,
  });
  const db = getFirestore(app, config.firestoreDatabaseId);

  const snap = await getDocs(collection(db, 'diaries'));
  console.log(`Found ${snap.size} total diary documents in Firestore.`);

  let totalDiariesUpdated = 0;
  let totalPhotosOptimized = 0;

  for (const docSnap of snap.docs) {
    const diary = docSnap.data() as DiaryEntry;
    if (!diary.photos || diary.photos.length === 0) continue;

    let diaryModified = false;
    const newPhotos: TravelPhoto[] = [];

    for (let pIdx = 0; pIdx < diary.photos.length; pIdx++) {
      const photo = diary.photos[pIdx];
      if (!photo.url || !photo.url.startsWith('data:image/')) {
        newPhotos.push(photo);
        continue;
      }

      try {
        const matches = photo.url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          newPhotos.push(photo);
          continue;
        }

        const originalBase64 = matches[2];
        const inputBuffer = Buffer.from(originalBase64, 'base64');
        const metadata = await sharp(inputBuffer).metadata();
        const origW = metadata.width || 0;
        const origH = metadata.height || 0;

        const isLargerThan720 = origW > 720 || origH > 720;
        const isExcessivelyLarge = inputBuffer.length > 250000;

        if (isLargerThan720 || isExcessivelyLarge) {
          // Resize to max 720 on width/height preserving aspect ratio
          const resizedBuffer = await sharp(inputBuffer)
            .resize({
              width: 720,
              height: 720,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({ quality: 82, progressive: true })
            .toBuffer();

          const resizedMetadata = await sharp(resizedBuffer).metadata();
          const newBase64 = resizedBuffer.toString('base64');
          const newDataUrl = `data:image/jpeg;base64,${newBase64}`;

          console.log(
            `[Diary ${diary.id} | "${diary.title}"] Photo ${pIdx}: ` +
            `${origW}x${origH} (${Math.round(inputBuffer.length / 1024)}KB) -> ` +
            `${resizedMetadata.width}x${resizedMetadata.height} (${Math.round(resizedBuffer.length / 1024)}KB)`
          );

          newPhotos.push({
            ...photo,
            url: newDataUrl,
          });
          diaryModified = true;
          totalPhotosOptimized++;
        } else {
          newPhotos.push(photo);
        }
      } catch (err) {
        console.error(`Error checking photo ${photo.id} in diary ${diary.id}:`, err);
        newPhotos.push(photo);
      }
    }

    if (diaryModified) {
      const updatedDiary = {
        ...diary,
        photos: newPhotos,
      };
      const docRef = doc(db, 'diaries', diary.id);
      await setDoc(docRef, updatedDiary);
      totalDiariesUpdated++;
      console.log(`Saved updated diary ${diary.id} to Firestore.`);
    }
  }

  console.log('--- Migration Verification Completed ---');
  console.log(`Total diaries updated: ${totalDiariesUpdated}`);
  console.log(`Total photos resized/optimized to <= 720px: ${totalPhotosOptimized}`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
