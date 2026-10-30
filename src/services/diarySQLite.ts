import { DiaryEntry, TravelPhoto } from '../types';
import { sortDiariesDescending } from '../utils/storage';

const API_BASE = '/api';

export async function fetchDiariesFromSQLite(): Promise<DiaryEntry[]> {
  const res = await fetch(`${API_BASE}/diaries`);
  if (!res.ok) throw new Error('Failed to fetch diaries from SQLite');
  return await res.json();
}

export async function saveDiaryToSQLite(entry: DiaryEntry): Promise<void> {
  const res = await fetch(`${API_BASE}/diaries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error('Failed to save diary to SQLite');
}

export async function deleteDiaryFromSQLite(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/diaries/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete diary from SQLite');
}

export async function migrateLocalToSQLite(diaries: DiaryEntry[]): Promise<number> {
  const res = await fetch(`${API_BASE}/migrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diaries }),
  });
  if (!res.ok) throw new Error('Migration failed');
  const data = await res.json();
  return data.count;
}

export async function incrementDiaryViewsSQLite(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/diaries/${id}/increment-views`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to increment views');
}

export async function resetAllDiaryViewsSQLite(): Promise<void> {
  const res = await fetch(`${API_BASE}/diaries/reset-views`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to reset views');
}

/**
 * Compatibility helper to match the existing Firestore service interface
 */
export async function syncInitialDiariesSQLite(): Promise<{ diaries: DiaryEntry[] }> {
  try {
    const diaries = await fetchDiariesFromSQLite();
    return { diaries: sortDiariesDescending(diaries) };
  } catch (err) {
    console.error('SQLite sync error:', err);
    return { diaries: [] };
  }
}
