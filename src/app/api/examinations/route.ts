import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getDb } from '@/lib/db';
import { extractExamQuestionsFromText } from '@/lib/pdf/exam-parser';
import { extractExaminationQuestionsWithVisionFallback } from '@/lib/pdf/exam-pipeline';

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

    let parsedQuestions = extractExamQuestionsFromText(docPages.map(p => p.extracted_text || '').join('\n'));
    if (exam.file_path && fs.existsSync(exam.file_path)) {
      const pdfBuffer = fs.readFileSync(exam.file_path);
      const outcome = await extractExaminationQuestionsWithVisionFallback(
        pdfBuffer,
        docPages.map(p => ({
          pdfPageIndex: p.pdf_page_index,
          text: p.extracted_text || '',
          ocrApplied: p.ocr_applied === 1,
          ocrConfidence: p.ocr_confidence || 0,
          pageType: p.page_type || 'digital'
        }))
      );
      parsedQuestions = outcome.questions;

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

    db.prepare('DELETE FROM questions WHERE examination_id = ?').run(exam.id);
    const insertQ = db.prepare(`
      INSERT INTO questions (
        id, examination_id, question_number, stem, options_json, designated_answer
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const q of parsedQuestions) {
      insertQ.run(
        crypto.randomUUID(),
        exam.id,
        q.questionNumber,
        q.stem,
        JSON.stringify(q.options),
        q.designatedAnswer || null
      );
    }

    db.prepare('UPDATE examinations SET total_questions = ? WHERE id = ?').run(parsedQuestions.length, exam.id);

    return NextResponse.json({
      success: true,
      questionCount: parsedQuestions.length,
      message: `Re-extracted ${parsedQuestions.length} questions from "${exam.title}".`
    });
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
