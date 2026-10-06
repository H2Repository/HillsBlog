import sharp from 'sharp';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import cfg from '../firebase-applet-config.json' with { type: 'json' };

const app = initializeApp(cfg);
const db = getFirestore(app, cfg.firestoreDatabaseId);

interface Photo {
  id: string;
  url: string;
  caption?: string;
  timestamp?: string;
  isCover?: boolean;
}

export function calculateFullHdDimensions(width: number, height: number): { width: number; height: number; wasScaled: boolean } {
  const isLandscape = width >= height;
  const boundW = isLandscape ? 1920 : 1080;
  const boundH = isLandscape ? 1080 : 1920;

  if (width <= boundW && height <= boundH) {
    return { width, height, wasScaled: false };
  }

  const ratio = Math.min(boundW / width, boundH / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
    wasScaled: true,
  };
}

async function run() {
  console.log('Connecting to Firestore to optimize and resave all existing diary photos...');
  const snap = await getDocs(collection(db, 'diaries'));
  console.log(`Found ${snap.size} diaries in collection.`);

  let totalPhotosOptimized = 0;
  let totalBytesSaved = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const photos: Photo[] = data.photos || [];
    let diaryModified = false;

    const newPhotos: Photo[] = [];

    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (p.url && p.url.startsWith('data:image/')) {
        const matches = p.url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches) {
          const originalBuffer = Buffer.from(matches[2], 'base64');
          const originalSize = originalBuffer.length;
          const image = sharp(originalBuffer);
          const meta = await image.metadata();

          const origW = meta.width || 1200;
          const origH = meta.height || 900;
          const { width: targetW, height: targetH, wasScaled } = calculateFullHdDimensions(origW, origH);

          // Resize if exceeding Full HD, then compress with quality 80
          let transformer = sharp(originalBuffer);
          if (wasScaled) {
            transformer = transformer.resize(targetW, targetH, { fit: 'inside' });
          }

          const compressedBuffer = await transformer
            .jpeg({ quality: 80, progressive: true, mozjpeg: true })
            .toBuffer();

          const newSize = compressedBuffer.length;
          const compressedDataUrl = `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;

          const savedBytes = originalSize - newSize;
          totalBytesSaved += Math.max(0, savedBytes);
          totalPhotosOptimized++;

          console.log(`[Diary: ${data.title}] Photo ${i}: ${origW}x${origH} -> ${targetW}x${targetH} (${wasScaled ? 'Full HD downscaled' : 'Full HD compliant'}), size: ${Math.round(originalSize / 1024)}KB -> ${Math.round(newSize / 1024)}KB (Saved ${Math.round(savedBytes / 1024)}KB)`);

          newPhotos.push({
            ...p,
            url: compressedDataUrl,
          });
          diaryModified = true;
          continue;
        }
      }
      newPhotos.push(p);
    }

    if (diaryModified) {
      const updatedData = {
        ...data,
        photos: newPhotos,
      };
      await setDoc(doc(db, 'diaries', docSnap.id), updatedData);
      console.log(`✓ Resaved diary '${data.title}' (ID: ${docSnap.id}) in Firestore with compressed photos.`);
    }
  }

  console.log(`\n🎉 Optimization Complete!`);
  console.log(`Total photos processed & re-saved: ${totalPhotosOptimized}`);
  console.log(`Total storage saved: ${Math.round(totalBytesSaved / 1024)}KB`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
