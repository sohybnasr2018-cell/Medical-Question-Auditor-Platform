import { getDb } from '@/lib/db';
import { SEED_BOOKS, SEED_EXAMINATION_QUESTIONS } from './representative-cases';
import { indexDocumentPages } from '@/lib/search/indexer';
import crypto from 'node:crypto';

export async function seedRepresentativeTestData(forceReset: boolean = false): Promise<{
  bookCount: number;
  questionCount: number;
  examinationId: string;
}> {
  const db = getDb();

  // Check if representative test suite is already seeded (do NOT skip just because user uploaded their own books)
  const existingExam = db.prepare("SELECT id FROM examinations WHERE id = 'exam-board-representative-test'").get() as { id: string } | undefined;

  if (existingExam && !forceReset) {
    return {
      bookCount: SEED_BOOKS.length,
      questionCount: SEED_EXAMINATION_QUESTIONS.length,
      examinationId: existingExam.id
    };
  }

  if (forceReset) {
    // Only reset representative test records so user-uploaded PDFs and real exams are preserved safely
    const demoBookIds = SEED_BOOKS.map(b => `'${b.id}'`).join(',');
    const demoExamId = 'exam-board-representative-test';
    db.prepare(`DELETE FROM evidence_citations WHERE audit_finding_id IN (SELECT id FROM audit_findings WHERE audit_session_id IN (SELECT id FROM audit_sessions WHERE examination_id = ?))`).run(demoExamId);
    db.prepare(`DELETE FROM option_analyses WHERE audit_finding_id IN (SELECT id FROM audit_findings WHERE audit_session_id IN (SELECT id FROM audit_sessions WHERE examination_id = ?))`).run(demoExamId);
    db.prepare(`DELETE FROM audit_findings WHERE audit_session_id IN (SELECT id FROM audit_sessions WHERE examination_id = ?)`).run(demoExamId);
    db.prepare(`DELETE FROM audit_sessions WHERE examination_id = ?`).run(demoExamId);
    db.prepare(`DELETE FROM questions WHERE examination_id = ?`).run(demoExamId);
    db.prepare(`DELETE FROM examinations WHERE id = ?`).run(demoExamId);
    db.prepare(`DELETE FROM document_chunks WHERE document_id IN (${demoBookIds})`).run();
    db.prepare(`DELETE FROM document_pages WHERE document_id IN (${demoBookIds})`).run();
    db.prepare(`DELETE FROM documents WHERE id IN (${demoBookIds})`).run();
  }

  // 1. Insert Reference Books
  const insertDoc = db.prepare(`
    INSERT OR IGNORE INTO documents (
      id, type, filename, file_path, file_size, page_count, title, subject, category, authors, edition, status, ocr_confidence_avg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPage = db.prepare(`
    INSERT OR IGNORE INTO document_pages (
      id, document_id, pdf_page_index, printed_page_number, extracted_text, has_native_text, ocr_applied, ocr_confidence, page_type, word_count, char_count, flagged_uncertain
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const book of SEED_BOOKS) {
    const avgConf = book.pages.reduce((s, p) => s + p.ocrConfidence, 0) / (book.pages.length || 1);
    insertDoc.run(
      book.id,
      'reference',
      `${book.title.replace(/[^\w\s-]/g, '')}.pdf`,
      `uploads/references/${book.id}.pdf`,
      1024 * 1024 * 15, // simulated 15MB file size
      book.pages.length,
      book.title,
      book.subject,
      book.category,
      book.authors,
      book.edition,
      'ready',
      Math.round(avgConf * 10) / 10
    );

    for (const page of book.pages) {
      const pageId = crypto.randomUUID();
      const words = page.text.split(/\s+/).filter(Boolean);
      insertPage.run(
        pageId,
        book.id,
        page.pdfPageIndex,
        page.printedPageNumber,
        page.text,
        page.pageType === 'digital' ? 1 : 0,
        page.pageType === 'scanned' ? 1 : 0,
        page.ocrConfidence,
        page.pageType,
        words.length,
        page.text.length,
        page.pageType === 'scanned' ? 1 : 0
      );
    }

    // Build BM25 / token index
    indexDocumentPages(book.id);
  }

  // 2. Insert Examination
  const examId = 'exam-board-representative-test';
  const insertExam = db.prepare(`
    INSERT OR IGNORE INTO examinations (
      id, document_id, title, total_questions, detected_subject_summary, status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertExam.run(
    examId,
    null,
    'Comprehensive Medical Board Examination (Representative Clinical Audit)',
    SEED_EXAMINATION_QUESTIONS.length,
    'Pharmacology, Pathology, Anatomy, Physiology, Microbiology, Medicine, Genetics',
    'parsed'
  );

  // 3. Insert Questions
  const insertQuestion = db.prepare(`
    INSERT OR IGNORE INTO questions (
      id, examination_id, question_number, stem, options_json, designated_answer, detected_primary_subject, detected_secondary_subjects, classification_confidence, topic, source_page_index
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const q of SEED_EXAMINATION_QUESTIONS) {
    const qId = `q-${examId}-${q.questionNumber}`;
    insertQuestion.run(
      qId,
      examId,
      q.questionNumber,
      q.stem,
      JSON.stringify(q.options),
      q.designatedAnswer,
      q.expectedSubject,
      JSON.stringify(['Clinical Medicine', 'Biomedical Sciences']),
      95.0,
      q.topic,
      1
    );
  }

  return {
    bookCount: SEED_BOOKS.length,
    questionCount: SEED_EXAMINATION_QUESTIONS.length,
    examinationId: examId
  };
}
