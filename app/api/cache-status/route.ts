import { NextResponse } from "next/server";
import { promises as fs } from 'fs';
import path from 'path';

export async function GET() {
  const CACHE_DIR = path.join(process.cwd(), '.cache');

  try {
    const files = await fs.readdir(CACHE_DIR);
    const stats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(CACHE_DIR, file);
        const stat = await fs.stat(filePath);
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content);

        let count = 0;
        if (Array.isArray(parsed)) {
          count = parsed.length;
        } else if (typeof parsed === 'object') {
          count = Object.keys(parsed).length;
        }

        return {
          file,
          sizeKB: (stat.size / 1024).toFixed(2),
          modified: stat.mtime,
          itemCount: count,
        };
      })
    );

    return NextResponse.json({
      cacheDir: CACHE_DIR,
      files: stats,
      totalFiles: files.length,
    });
  } catch (err: any) {
    return NextResponse.json({
      error: "Cache directory empty or not accessible",
      message: err.message,
    });
  }
}