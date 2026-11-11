import { getDb } from '../src/lib/db/index';
import { extractExamQuestionsFromText } from '../src/lib/pdf/exam-parser';
import { executeAuditSession } from '../src/lib/audit/engine';
import crypto from 'node:crypto';

async function repairAndAudit() {
  console.log('--- REPAIRING USER UPLOADED EXAM & BOOKS ---');
  const db = getDb();

  // 1. Update book subjects
  db.prepare("UPDATE documents SET subject = 'Parasitology' WHERE title LIKE '%para%'").run();
  db.prepare("UPDATE documents SET subject = 'Biochemistry' WHERE title LIKE '%bio%'").run();
  db.prepare("UPDATE documents SET subject = 'Pathology' WHERE title LIKE '%path%'").run();
  db.prepare("UPDATE documents SET subject = 'Pharmacology' WHERE title LIKE '%pharma%'").run();

  const books = db.prepare("SELECT title, subject, page_count FROM documents WHERE type = 'reference'").all();
  console.log('Updated Reference Books:', books);

  // 2. Find Dr X Hema 2 exam document
  const examDoc = db.prepare("SELECT id, title FROM documents WHERE title LIKE '%Dr X Hema%'").get() as any;
  if (!examDoc) {
    console.log('Exam doc not found');
    return;
  }

  // Get full text
  const pages = db.prepare("SELECT extracted_text FROM document_pages WHERE document_id = ? ORDER BY pdf_page_index ASC").all(examDoc.id) as Array<{ extracted_text: string }>;
  const fullText = pages.map(p => p.extracted_text).join('\n');

  // Re-parse with enhanced extractor
  const parsedQuestions = extractExamQuestionsFromText(fullText);
  console.log(`Re-parsed ${parsedQuestions.length} questions.`);

  // Find or create examination record
  const examRecord = db.prepare("SELECT id FROM examinations WHERE document_id = ?").get(examDoc.id) as any;
  const examId = examRecord?.id || crypto.randomUUID();

  // Clear old questions
  db.prepare("DELETE FROM questions WHERE examination_id = ?").run(examId);

  // Insert newly parsed questions
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

  db.prepare("UPDATE examinations SET total_questions = ? WHERE id = ?").run(parsedQuestions.length, examId);
  console.log('Saved re-parsed questions to database.');

  // Let's sample Question 1
  const q1 = db.prepare("SELECT * FROM questions WHERE examination_id = ? AND question_number = 1").get(examId) as any;
  console.log('\n--- QUESTION 1 SAMPLE ---');
  console.log('Stem:', q1.stem);
  console.log('Options:', q1.options_json);

  // 3. Clear old failed audit sessions for this exam
  db.prepare("DELETE FROM audit_findings WHERE audit_session_id IN (SELECT id FROM audit_sessions WHERE examination_id = ?)").run(examId);
  db.prepare("DELETE FROM audit_sessions WHERE examination_id = ?").run(examId);

  // 4. Create new audit session using configured Gemini AI provider
  db.prepare("UPDATE system_settings SET value = 'gemini-3.5-flash-lite' WHERE key = 'gemini_model'").run();
  const configuredProvider = (db.prepare("SELECT value FROM system_settings WHERE key = 'ai_provider'").get() as any)?.value || 'gemini';
  const newSessionId = crypto.randomUUID();
  const sessionName = 'Comprehensive Gemini AI Audit: Dr X Hema 2 Previous Exams';
  db.prepare(`
    INSERT INTO audit_sessions (
      id, name, examination_id, status, progress_percent, total_questions, selected_reference_ids, ai_provider_used
    ) VALUES (?, ?, ?, 'pending', 0, ?, '[]', ?)
  `).run(newSessionId, sessionName, examId, parsedQuestions.length, configuredProvider);

  console.log('\n--- LAUNCHING GEMINI AUDIT ON RE-PARSED REAL EXAM ---');
  await executeAuditSession(newSessionId, (progress) => {
    if (progress.currentQuestion <= 10 || progress.currentQuestion % 20 === 0 || progress.currentQuestion === progress.totalQuestions) {
      const f = progress.lastFinding;
      console.log(`[Q${progress.currentQuestion}/${progress.totalQuestions}] ${f.category} | Proposed: ${f.proposedAnswer || 'None'}`);
    }
  });

  const sampleFinding = db.prepare("SELECT * FROM audit_findings WHERE audit_session_id = ? AND question_number = 1").get(newSessionId) as any;
  const sampleOptions = db.prepare("SELECT * FROM option_analyses WHERE audit_finding_id = ?").all(sampleFinding.id);

  console.log('\n--- AUDIT RESULT FOR QUESTION 1 (IMIPENEM) ---');
  console.log('Category:', sampleFinding.findings_category);
  console.log('Proposed Answer:', sampleFinding.proposed_answer);
  console.log('Detailed Explanation:', sampleFinding.detailed_explanation);
  console.log('Option Analyses:');
  for (const opt of sampleOptions as any[]) {
    console.log(`  Option ${opt.option_letter}) [${opt.is_scientifically_correct ? 'CORRECT' : 'INCORRECT'}] ${opt.option_text}`);
    console.log(`     Rationale: ${opt.evaluation_rationale}`);
    console.log(`     Quote: "${opt.citation_quote}"`);
  }
}

repairAndAudit().catch(err => {
  console.error('Repair error:', err);
});
