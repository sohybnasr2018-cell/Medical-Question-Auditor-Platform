import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'node:fs';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const search = url.searchParams.get('q') || '';
    const subjectFilter = url.searchParams.get('subject') || '';

    let query = `
      SELECT 
        d.*,
        (SELECT COUNT(*) FROM document_pages WHERE document_id = d.id) as real_page_count,
        (SELECT COUNT(*) FROM document_chunks WHERE document_id = d.id) as chunk_count
      FROM documents d
      WHERE d.type = 'reference'
    `;

    const params: any[] = [];
    if (search) {
      query += ` AND (d.title LIKE ? OR d.authors LIKE ? OR d.subject LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (subjectFilter) {
      query += ` AND d.subject = ?`;
      params.push(subjectFilter);
    }

    query += ` ORDER BY d.created_at DESC`;

    const references = db.prepare(query).all(...params);
    return NextResponse.json({ references });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, title, subject, category, authors, edition } = body;

    if (!id) {
      return NextResponse.json({ error: 'Book ID is required' }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`
      UPDATE documents
      SET title = COALESCE(?, title),
          subject = COALESCE(?, subject),
          category = COALESCE(?, category),
          authors = COALESCE(?, authors),
          edition = COALESCE(?, edition),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND type = 'reference'
    `).run(title ?? null, subject ?? null, category ?? null, authors ?? null, edition ?? null, id);

    return NextResponse.json({ success: true, message: 'Reference metadata updated' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Book ID is required' }, { status: 400 });
    }

    const db = getDb();
    const doc = db.prepare("SELECT file_path FROM documents WHERE id = ?").get(id) as { file_path: string } | undefined;

    if (doc?.file_path && fs.existsSync(doc.file_path)) {
      try { fs.unlinkSync(doc.file_path); } catch {}
    }

    db.prepare("DELETE FROM document_chunks WHERE document_id = ?").run(id);
    db.prepare("DELETE FROM document_pages WHERE document_id = ?").run(id);
    db.prepare("DELETE FROM documents WHERE id = ?").run(id);

    return NextResponse.json({ success: true, message: 'Reference deleted' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
