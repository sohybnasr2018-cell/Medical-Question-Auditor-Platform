import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { getDb } from '@/lib/db';
import { extractExamQuestionsFromPages } from '@/lib/pdf/exam-parser';
import {
  extractExaminationQuestionsWithVisionFallback,
  extractExaminationFromDirectImageUpload,
  saveParsedExamQuestions
} from '@/lib/pdf/exam-pipeline';

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const examId = url.searchParams.get('id');

    if (examId) {
      const examination = db.prepare("SELECT * FROM examinations WHERE id = ?").get(examId) as any;
      if (!examination) {
        return NextResponse.json({ error: 'Examination not found' }, { status: 404 });
      }

      const questions = db.prepare(`
        SELECT * FROM questions
        WHERE examination_id = ?
        ORDER BY question_number ASC
      `).all(examId);

      const recentSession = db.prepare(`
        SELECT id, status, confirmed_errors_count, multiple_correct_count, completed_at
        FROM audit_sessions
        WHERE examination_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(examId);

      return NextResponse.json({
        examination,
        questions,
        recentSession
      });
    }

    const examinations = db.prepare(`
      SELECT 
        e.*,
        (SELECT COUNT(*) FROM questions WHERE examination_id = e.id) as question_count,
        (SELECT COUNT(*) FROM questions WHERE examination_id = e.id AND json_array_length(options_json) >= 2) as mcq_count,
        (SELECT COUNT(*) FROM questions WHERE examination_id = e.id AND COALESCE(TRIM(designated_answer), '') != '') as keyed_count,
        (SELECT COUNT(*) FROM questions WHERE examination_id = e.id AND COALESCE(TRIM(image_path), '') != '') as image_count,
        (SELECT id FROM audit_sessions WHERE examination_id = e.id ORDER BY created_at DESC LIMIT 1) as latest_session_id,
        (SELECT status FROM audit_sessions WHERE examination_id = e.id ORDER BY created_at DESC LIMIT 1) as latest_session_status
      FROM examinations e
      ORDER BY e.created_at DESC
    `).all();

    return NextResponse.json({ examinations });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const examId = body?.id;
    if (!examId) {
      return NextResponse.json({ error: 'Exam ID required' }, { status: 400 });
    }

    const db = getDb();
    const exam = db.prepare(`
      SELECT e.id, e.document_id, e.title, d.file_path
      FROM examinations e
      LEFT JOIN documents d ON d.id = e.document_id
      WHERE e.id = ?
    `).get(examId) as { id: string; document_id: string | null; title: string; file_path: string | null } | undefined;

    if (!exam || !exam.document_id) {
      return NextResponse.json({ error: 'Examination or source document not found' }, { status: 404 });
    }

    const docPages = db.prepare(`
      SELECT pdf_page_index, extracted_text, ocr_applied, ocr_confidence, page_type
      FROM document_pages
      WHERE document_id = ?
      ORDER BY pdf_page_index ASC
    `).all(exam.document_id) as Array<{
      pdf_page_index: number;
      extracted_text: string;
      ocr_applied: number;
      ocr_confidence: number;
      page_type: 'digital' | 'scanned' | 'mixed';
    }>;

    let parsedQuestions = extractExamQuestionsFromPages(
      docPages.map(p => ({ pdfPageIndex: p.pdf_page_index, text: p.extracted_text || '' }))
    );
    let attachedImagesCount = 0;

    if (exam.file_path && fs.existsSync(exam.file_path)) {
      const fileBuffer = fs.readFileSync(exam.file_path);
      const isImageFile = /\.(png|jpe?g|webp)$/i.test(exam.file_path);

      const outcome = isImageFile
        ? await extractExaminationFromDirectImageUpload(
            fileBuffer,
            exam.file_path.toLowerCase().endsWith('.png') ? 'image/png' : exam.file_path.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg',
            exam.document_id
          )
        : await extractExaminationQuestionsWithVisionFallback(
            fileBuffer,
            docPages.map(p => ({
              pdfPageIndex: p.pdf_page_index,
              text: p.extracted_text || '',
              ocrApplied: p.ocr_applied === 1,
              ocrConfidence: p.ocr_confidence || 0,
              pageType: p.page_type || 'digital'
            })),
            exam.document_id
          );

      parsedQuestions = outcome.questions;
      attachedImagesCount = outcome.attachedImagesCount;

      if (outcome.updatedPageTexts.size > 0) {
        const updatePageText = db.prepare(`
          UPDATE document_pages
          SET extracted_text = ?, ocr_applied = 1, ocr_confidence = 99, word_count = ?, char_count = ?, flagged_uncertain = 0
          WHERE document_id = ? AND pdf_page_index = ?
        `);
        for (const [pageIdx, textVal] of outcome.updatedPageTexts.entries()) {
          const wc = textVal.split(/\s+/).filter(Boolean).length;
          updatePageText.run(textVal, wc, textVal.length, exam.document_id, pageIdx);
        }
      }
    }

    saveParsedExamQuestions(exam.id, parsedQuestions);

    return NextResponse.json({
      success: true,
      questionCount: parsedQuestions.length,
      attachedImagesCount,
      message: `Re-extracted ${parsedQuestions.length} questions (${attachedImagesCount} with images) from "${exam.title}".`
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const questionId = String(body?.questionId || '').trim();
    const rawAns = String(body?.designatedAnswer ?? '').trim().toUpperCase();
    if (!questionId) {
      return NextResponse.json({ error: 'questionId required' }, { status: 400 });
    }

    const letters = Array.from(
      new Set(
        rawAns
          .split(/[,&\s]+/)
          .map(s => s.trim())
          .filter(s => /^[A-E]$/.test(s))
      )
    );
    const normalized = letters.length > 0 ? letters.join(', ') : (rawAns ? rawAns : null);

    const db = getDb();
    const res = db.prepare('UPDATE questions SET designated_answer = ? WHERE id = ?').run(normalized, questionId);
    if (res.changes === 0) {
      return NextResponse.json({ error: 'Question not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, designatedAnswer: normalized || '' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Exam ID required' }, { status: 400 });

    const db = getDb();
    db.prepare("DELETE FROM questions WHERE examination_id = ?").run(id);
    db.prepare("DELETE FROM examinations WHERE id = ?").run(id);

    return NextResponse.json({ success: true, message: 'Examination deleted' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
