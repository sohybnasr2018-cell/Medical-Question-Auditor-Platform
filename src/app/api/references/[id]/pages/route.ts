import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const url = new URL(req.url);
    const pageNum = url.searchParams.get('page');

    const book = db.prepare("SELECT * FROM documents WHERE id = ? AND type = 'reference'").get(id);
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (pageNum) {
      const page = db.prepare(`
        SELECT * FROM document_pages
        WHERE document_id = ? AND (pdf_page_index = ? OR printed_page_number = ?)
        LIMIT 1
      `).get(id, parseInt(pageNum, 10), pageNum);

      return NextResponse.json({ book, page });
    }

    const pages = db.prepare(`
      SELECT id, pdf_page_index, printed_page_number, has_native_text, ocr_applied, ocr_confidence, page_type, word_count, char_count, flagged_uncertain, substr(extracted_text, 1, 350) as snippet
      FROM document_pages
      WHERE document_id = ?
      ORDER BY pdf_page_index ASC
    `).all(id);

    return NextResponse.json({ book, pages });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
