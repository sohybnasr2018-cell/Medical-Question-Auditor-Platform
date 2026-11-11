import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { getDb } from '@/lib/db';
import { indexDocumentPages } from '@/lib/search/indexer';
import { ocrPdfScannedPages } from '@/lib/pdf/ocr';
import { detectMedicalDiscipline } from '@/lib/pdf/exam-parser';

export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const book = db.prepare("SELECT * FROM documents WHERE id = ? AND type = 'reference'").get(id) as any;
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const pages = db.prepare(`
      SELECT id, pdf_page_index, extracted_text, word_count, page_type, ocr_confidence
      FROM document_pages
      WHERE document_id = ?
      ORDER BY pdf_page_index ASC
    `).all(id) as any[];

    const pagesNeedingOcr = pages.filter(p => p.page_type === 'scanned' || (p.word_count || 0) < 15);
    let ocrPagesProcessed = 0;

    if (pagesNeedingOcr.length > 0 && book.file_path && fs.existsSync(book.file_path)) {
      db.prepare("UPDATE documents SET status = 'running_ocr' WHERE id = ?").run(id);
      const pdfBuffer = fs.readFileSync(book.file_path);
      const ocrMap = await ocrPdfScannedPages(
        pdfBuffer,
        pagesNeedingOcr.map(p => ({ pageNumber: p.pdf_page_index, existingText: p.extracted_text || '' })),
        2
      );

      const updatePage = db.prepare(`
        UPDATE document_pages
        SET extracted_text = ?, ocr_applied = 1, ocr_confidence = ?, word_count = ?, char_count = ?, flagged_uncertain = ?
        WHERE id = ?
      `);

      for (const page of pagesNeedingOcr) {
        const res = ocrMap.get(page.pdf_page_index);
        if (!res) continue;
        const text = res.text || page.extracted_text || '';
        const wc = text.split(/\s+/).filter(Boolean).length;
        updatePage.run(text, res.confidence, wc, text.length, res.confidence < 70 ? 1 : 0, page.id);
        ocrPagesProcessed++;
      }

      const avgRow = db.prepare('SELECT AVG(ocr_confidence) as avg_conf FROM document_pages WHERE document_id = ?').get(id) as any;
      if (avgRow?.avg_conf != null) {
        db.prepare('UPDATE documents SET ocr_confidence_avg = ? WHERE id = ?').run(Math.round(avgRow.avg_conf * 10) / 10, id);
      }
    }

    if (!book.subject || book.subject === 'General Medical Sciences') {
      const sampleText = pages.slice(0, 5).map(p => p.extracted_text || '').join(' ');
      const detected = detectMedicalDiscipline(`${book.title} ${book.filename} ${sampleText.slice(0, 3000)}`);
      if (detected && detected !== 'General Medical Sciences') {
        db.prepare('UPDATE documents SET subject = ? WHERE id = ?').run(detected, id);
      }
    }

    db.prepare("UPDATE documents SET status = 'building_index' WHERE id = ?").run(id);

    // Re-index chunks
    indexDocumentPages(id);

    db.prepare("UPDATE documents SET status = 'ready', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);

    return NextResponse.json({
      success: true,
      ocrPagesProcessed,
      message: `Reference "${book.title}" reprocessed (${ocrPagesProcessed} OCR pages) and re-indexed successfully.`
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
