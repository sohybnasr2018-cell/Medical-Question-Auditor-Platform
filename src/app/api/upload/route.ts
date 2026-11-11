import { NextRequest, NextResponse } from 'next/server';
import { getDb, REFERENCES_DIR, EXAMINATIONS_DIR } from '@/lib/db';
import { parsePdfDocument } from '@/lib/pdf/parser';
import { ocrPdfScannedPages } from '@/lib/pdf/ocr';
import { indexDocumentPages } from '@/lib/search/indexer';
import { detectMedicalDiscipline } from '@/lib/pdf/exam-parser';
import { extractExaminationQuestionsWithVisionFallback } from '@/lib/pdf/exam-pipeline';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const maxDuration = 300; // 5 minutes for large PDFs

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const docType = (formData.get('type') as string) || 'reference';
    const customTitle = (formData.get('title') as string) || '';
    let customSubject = (formData.get('subject') as string) || '';
    const customCategory = (formData.get('category') as string) || 'General';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 5 || buffer.toString('utf8', 0, 4) !== '%PDF') {
      return NextResponse.json({ error: 'Uploaded file is not a valid PDF document.' }, { status: 400 });
    }

    const docId = crypto.randomUUID();
    const originalFilename = file.name;
    const sanitizedFilename = `${docId}-${originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const targetDir = docType === 'examination' ? EXAMINATIONS_DIR : REFERENCES_DIR;
    const filePath = path.join(targetDir, sanitizedFilename);

    fs.writeFileSync(filePath, buffer);

    const db = getDb();
    const title = customTitle || originalFilename.replace(/\.pdf$/i, '');

    // Auto-detect subject if not provided
    if (!customSubject) {
      customSubject = detectMedicalDiscipline(title + ' ' + originalFilename);
    }

    const insertDoc = db.prepare(`
      INSERT INTO documents (
        id, type, filename, file_path, file_size, page_count, title, subject, category, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertDoc.run(
      docId,
      docType,
      originalFilename,
      filePath,
      buffer.length,
      0,
      title,
      customSubject || null,
      customCategory,
      'extracting_text'
    );

    const parseResult = await parsePdfDocument(buffer, title);

    db.prepare(`
      UPDATE documents
      SET page_count = ?, ocr_confidence_avg = ?, status = ?
      WHERE id = ?
    `).run(
      parseResult.pageCount,
      parseResult.avgConfidence,
      'running_ocr',
      docId
    );

    const insertPage = db.prepare(`
      INSERT INTO document_pages (
        id, document_id, pdf_page_index, printed_page_number, extracted_text,
        has_native_text, ocr_applied, ocr_confidence, page_type, word_count,
        char_count, flagged_uncertain
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let totalConfidence = 0;
    let fullDocText = '';
    const finalPagesForPipeline: Array<{
      pdfPageIndex: number;
      text: string;
      ocrApplied: boolean;
      ocrConfidence: number;
      pageType: 'digital' | 'scanned' | 'mixed';
    }> = [];

    const pagesNeedingOcr = parseResult.pages
      .filter(p => p.pageType === 'scanned' || p.wordCount < 15)
      .map(p => ({ pageNumber: p.pdfPageIndex, existingText: p.text }));

    const ocrResultsMap = pagesNeedingOcr.length > 0
      ? await ocrPdfScannedPages(buffer, pagesNeedingOcr, 2)
      : new Map();

    for (const page of parseResult.pages) {
      const pageId = crypto.randomUUID();
      let finalText = page.text;
      let ocrConfidence = page.ocrConfidence;
      let ocrApplied = false;

      const ocrRes = ocrResultsMap.get(page.pdfPageIndex);
      if (ocrRes) {
        finalText = ocrRes.text || finalText;
        ocrConfidence = ocrRes.confidence;
        ocrApplied = true;
      }

      totalConfidence += ocrConfidence;
      fullDocText += '\n' + finalText;
      finalPagesForPipeline.push({
        pdfPageIndex: page.pdfPageIndex,
        text: finalText,
        ocrApplied,
        ocrConfidence,
        pageType: page.pageType
      });

      insertPage.run(
        pageId,
        docId,
        page.pdfPageIndex,
        page.printedPageNumber,
        finalText,
        page.hasNativeText ? 1 : 0,
        ocrApplied ? 1 : 0,
        ocrConfidence,
        page.pageType,
        finalText.split(/\s+/).filter(Boolean).length,
        finalText.length,
        ocrConfidence < 70 ? 1 : 0
      );
    }

    const avgDocConfidence = parseResult.pages.length > 0
      ? Math.round((totalConfidence / parseResult.pages.length) * 10) / 10
      : 0;

    if (docType === 'reference') {
      if (!customSubject || customSubject === 'General Medical Sciences') {
        const refinedSubject = detectMedicalDiscipline(title + ' ' + originalFilename + ' ' + fullDocText.slice(0, 5000));
        if (refinedSubject && refinedSubject !== 'General Medical Sciences') {
          customSubject = refinedSubject;
          db.prepare('UPDATE documents SET subject = ? WHERE id = ?').run(customSubject, docId);
        }
      }
      db.prepare("UPDATE documents SET status = 'building_index' WHERE id = ?").run(docId);
      indexDocumentPages(docId);

      db.prepare(`
        UPDATE documents
        SET status = 'ready', ocr_confidence_avg = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(avgDocConfidence, docId);

      return NextResponse.json({
        success: true,
        documentId: docId,
        type: 'reference',
        title,
        subject: customSubject,
        pageCount: parseResult.pageCount,
        avgConfidence: avgDocConfidence,
        status: 'ready'
      });
    } else {
      const outcome = await extractExaminationQuestionsWithVisionFallback(buffer, finalPagesForPipeline);
      const parsedQuestions = outcome.questions;

      if (outcome.updatedPageTexts.size > 0) {
        const updatePageText = db.prepare(`
          UPDATE document_pages
          SET extracted_text = ?, ocr_applied = 1, ocr_confidence = 99, word_count = ?, char_count = ?, flagged_uncertain = 0
          WHERE document_id = ? AND pdf_page_index = ?
        `);
        for (const [pageIdx, textVal] of outcome.updatedPageTexts.entries()) {
          const wc = textVal.split(/\s+/).filter(Boolean).length;
          updatePageText.run(textVal, wc, textVal.length, docId, pageIdx);
        }
      }

      const examId = crypto.randomUUID();

      const insertExam = db.prepare(`
        INSERT INTO examinations (
          id, document_id, title, total_questions, status
        ) VALUES (?, ?, ?, ?, 'parsed')
      `);

      insertExam.run(examId, docId, title, parsedQuestions.length);

      const insertQ = db.prepare(`
        INSERT INTO questions (
          id, examination_id, question_number, stem, options_json, designated_answer
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const q of parsedQuestions) {
        insertQ.run(
          crypto.randomUUID(),
          examId,
          q.questionNumber,
          q.stem,
          JSON.stringify(q.options),
          q.designatedAnswer || null
        );
      }

      db.prepare("UPDATE documents SET status = 'ready' WHERE id = ?").run(docId);

      return NextResponse.json({
        success: true,
        documentId: docId,
        examinationId: examId,
        type: 'examination',
        title,
        questionCount: parsedQuestions.length,
        status: 'parsed'
      });
    }
  } catch (error: any) {
    console.error('Upload processing error:', error);
    return NextResponse.json({
      error: 'Failed to process PDF document',
      details: error.message
    }, { status: 500 });
  }
}
