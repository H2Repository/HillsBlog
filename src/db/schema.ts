import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: integer('created_at').default(Date.now()),
});

export const diaries = sqliteTable('diaries', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  date: text('date').notNull(),
  time: text('time').notNull(),
  // JSON fields for complex objects
  location: text('location', { mode: 'json' }).notNull(),
  photos: text('photos', { mode: 'json' }).notNull(),
  weather: text('weather').notNull(),
  moodTags: text('mood_tags', { mode: 'json' }).notNull(),
  localInsights: text('local_insights', { mode: 'json' }).notNull(),
  rating: integer('rating').notNull(),
  views: integer('views').default(0),
  hasSubcollectionPhotos: integer('has_subcollection_photos', { mode: 'boolean' }),
  totalPhotosCount: integer('total_photos_count'),
  includeInDistance: integer('include_in_distance', { mode: 'boolean' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const visitorLogs = sqliteTable('visitor_logs', {
  id: text('id').primaryKey(),
  timestamp: integer('timestamp').notNull(),
  lat: text('lat'),
  lng: text('lng'),
  city: text('city'),
  country: text('country'),
  region: text('region'),
  diaryId: text('diary_id'),
  diaryTitle: text('diary_title'),
  device: text('device'),
  ipMasked: text('ip_masked'),
});
