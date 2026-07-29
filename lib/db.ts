import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

// Singleton pattern for database connection
// In serverless, connections are reused within the same execution context
let cachedDb: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (cachedDb) {
    return cachedDb;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Please add it to your .env.local file.\n' +
      'Get it from: Supabase Dashboard > Project Settings > Database > Connection string (URI)'
    );
  }

  // Create postgres connection
  // max: 1 is important for serverless to prevent connection exhaustion
  const client = postgres(process.env.DATABASE_URL, {
    max: 1,
    idle_timeout: 20,
    max_lifetime: 60 * 30, // 30 minutes
  });

  cachedDb = drizzle(client, { schema });
  return cachedDb;
}

export const db = getDb();
