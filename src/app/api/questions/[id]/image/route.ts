import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, PAGES_DIR } from '@/lib/db';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf'
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const row = db.prepare('SELECT image_path FROM questions WHERE id = ?').get(id) as
      | { image_path: string | null }
      | undefined;

    if (!row?.image_path) {
      return NextResponse.json({ error: 'Question image not found' }, { status: 404 });
    }

    const safeName = path.basename(row.image_path);
    const fullPath = path.join(PAGES_DIR, safeName);
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json({ error: 'Image file missing on disk' }, { status: 404 });
    }

    const bytes = fs.readFileSync(fullPath);
    const ext = path.extname(safeName).toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'image/png';

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'private, max-age=3600'
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
