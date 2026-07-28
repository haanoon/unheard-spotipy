// Cache utilities for storing Spotify API responses locally
import { promises as fs } from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), '.cache');

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    console.log(`[CACHE HIT] ${key}`);
    return parsed as T;
  } catch {
    console.log(`[CACHE MISS] ${key}`);
    return null;
  }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[CACHE WRITE] ${key}`);
  } catch (err) {
    console.error(`[CACHE ERROR] Failed to write ${key}:`, err);
  }
}

export async function clearCache(): Promise<void> {
  try {
    const files = await fs.readdir(CACHE_DIR);
    await Promise.all(
      files.map(file => fs.unlink(path.join(CACHE_DIR, file)))
    );
    console.log('[CACHE] Cleared all cache files');
  } catch (err) {
    console.error('[CACHE ERROR] Failed to clear cache:', err);
  }
}