import ExcelJS from 'exceljs';
import { getDb } from '@/lib/db';

export async function generateExcelAuditReport(sessionId: string): Promise<Buffer> {
  const db = getDb();

  const session = db.prepare(`
    SELECT s.*, e.title as exam_title
    FROM audit_sessions s
    JOIN examinations e ON e.id = s.examination_id
    WHERE s.id = ?
  `).get(sessionId) as any;

  if (!session) {
    throw new Error('Audit session not found');
  }

  const findings = db.prepare(`
    SELECT 
      f.*,
      q.stem,
      q.options_json,
      q.detected_primary_subject,
      q.detected_secondary_subjects,
      q.topic
    FROM audit_findings f
    JOIN questions q ON q.id = f.question_id
    WHERE f.audit_session_id = ?
    ORDER BY f.question_number ASC
  `).all(sessionId) as any[];

  const options = db.prepare(`
    SELECT o.*, f.question_number
    FROM option_analyses o
    JOIN audit_findings f ON f.id = o.audit_finding_id
    WHERE f.audit_session_id = ?
    ORDER BY f.question_number ASC, o.option_letter ASC
  `).all(sessionId) as any[];

  const citations = db.prepare(`
    SELECT c.*, f.question_number
    FROM evidence_citations c
    JOIN audit_findings f ON f.id = c.audit_finding_id
    WHERE f.audit_session_id = ?
    ORDER BY f.question_number ASC
  `).all(sessionId) as any[];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Medical Question Auditor & Validator';
  workbook.lastModifiedBy = 'Medical Knowledge Processing Specialist';
  workbook.created = new Date();

  // Helper for styling table headers
  const applyHeaderStyle = (row: ExcelJS.Row, bgColor = 'FF0F766E') => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    row.alignment = { vertical: 'middle', horizontal: 'center' };
    row.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bgColor }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'medium' },
        right: { style: 'thin' }
      };
    });
  };

  // 1. Overall Summary Sheet
  const summarySheet = workbook.addWorksheet('Overall Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 35 },
    { header: 'Value', key: 'value', width: 45 }
  ];
  applyHeaderStyle(summarySheet.getRow(1), 'FF134E4A');

  summarySheet.addRow({ metric: 'Examination Title', value: session.exam_title });
  summarySheet.addRow({ metric: 'Audit Session ID', value: session.id });
  summarySheet.addRow({ metric: 'Audit Status', value: session.status.toUpperCase() });
  summarySheet.addRow({ metric: 'Audit Completed At', value: session.completed_at || 'In Progress' });
  summarySheet.addRow({ metric: 'Total Questions Audited', value: session.total_questions });
  summarySheet.addRow({ metric: 'Confirmed Scientific Errors', value: session.confirmed_errors_count });
  summarySheet.addRow({ metric: 'Multiple Correct Answers Detected', value: session.multiple_correct_count });
  summarySheet.addRow({ metric: 'Questions with No Correct Answer', value: session.no_correct_count });
  summarySheet.addRow({ metric: 'Ambiguous / Defective Wording Questions', value: session.ambiguous_count });
  summarySheet.addRow({ metric: 'Questions with Insufficient Evidence', value: session.insufficient_evidence_count });
  summarySheet.addRow({ metric: 'AI Auditor & Knowledge Engine', value: session.ai_provider_used || 'built_in' });

  // 2. All Questions Sheet
  const allSheet = workbook.addWorksheet('All Questions');
  allSheet.columns = [
    { header: 'Q#', key: 'q_num', width: 8 },
    { header: 'Primary Subject', key: 'subject', width: 22 },
    { header: 'Topic', key: 'topic', width: 25 },
    { header: 'Question Stem', key: 'stem', width: 50 },
    { header: 'Original Key', key: 'orig_key', width: 14 },
    { header: 'Proposed Answer', key: 'prop_key', width: 16 },
    { header: 'Finding Category', key: 'category', width: 22 },
    { header: 'Severity', key: 'severity', width: 14 },
    { header: 'Confidence', key: 'confidence', width: 14 },
    { header: 'Detailed Scientific Explanation', key: 'explanation', width: 55 },
    { header: 'Review Status', key: 'review_status', width: 16 },
    { header: 'Reviewer Notes', key: 'notes', width: 30 }
  ];
  applyHeaderStyle(allSheet.getRow(1), 'FF0F766E');

  for (const f of findings) {
    allSheet.addRow({
      q_num: f.question_number,
      subject: f.detected_primary_subject,
      topic: f.topic || 'General',
      stem: f.stem,
      orig_key: f.original_designated_answer || 'N/A',
      prop_key: f.proposed_answer || 'None',
      category: f.findings_category.replace(/_/g, ' ').toUpperCase(),
      severity: f.error_severity.toUpperCase(),
      confidence: `${f.confidence_score}%`,
      explanation: f.detailed_explanation,
      review_status: f.human_review_status.toUpperCase(),
      notes: f.human_notes || ''
    });
  }

  // 3. Confirmed Errors Sheet
  const errSheet = workbook.addWorksheet('Confirmed Errors');
  errSheet.columns = allSheet.columns;
  applyHeaderStyle(errSheet.getRow(1), 'FFE11D48'); // Red header

  for (const f of findings.filter(x => x.findings_category === 'confirmed_error')) {
    errSheet.addRow({
      q_num: f.question_number,
      subject: f.detected_primary_subject,
      topic: f.topic || 'General',
      stem: f.stem,
      orig_key: f.original_designated_answer || 'N/A',
      prop_key: f.proposed_answer || 'None',
      category: f.findings_category.replace(/_/g, ' ').toUpperCase(),
      severity: f.error_severity.toUpperCase(),
      confidence: `${f.confidence_score}%`,
      explanation: f.detailed_explanation,
      review_status: f.human_review_status.toUpperCase(),
      notes: f.human_notes || ''
    });
  }

  // 4. Multiple Correct Answers Sheet
  const multiSheet = workbook.addWorksheet('Multiple Correct Answers');
  multiSheet.columns = allSheet.columns;
  applyHeaderStyle(multiSheet.getRow(1), 'FF7C3AED'); // Purple header

  for (const f of findings.filter(x => x.has_multiple_correct === 1)) {
    multiSheet.addRow({
      q_num: f.question_number,
      subject: f.detected_primary_subject,
      topic: f.topic || 'General',
      stem: f.stem,
      orig_key: f.original_designated_answer || 'N/A',
      prop_key: f.proposed_answer || 'None',
      category: 'MULTIPLE CORRECT ANSWERS',
      severity: f.error_severity.toUpperCase(),
      confidence: `${f.confidence_score}%`,
      explanation: f.detailed_explanation,
      review_status: f.human_review_status.toUpperCase(),
      notes: f.human_notes || ''
    });
  }

  // 5. Incorrect Answer Keys Sheet
  const wrongKeySheet = workbook.addWorksheet('Incorrect Answer Keys');
  wrongKeySheet.columns = allSheet.columns;
  applyHeaderStyle(wrongKeySheet.getRow(1), 'FFD97706'); // Amber header

  for (const f of findings.filter(x => x.original_designated_answer !== x.proposed_answer && x.findings_category === 'confirmed_error')) {
    wrongKeySheet.addRow({
      q_num: f.question_number,
      subject: f.detected_primary_subject,
      topic: f.topic || 'General',
      stem: f.stem,
      orig_key: f.original_designated_answer || 'N/A',
      prop_key: f.proposed_answer || 'None',
      category: 'INCORRECT ANSWER KEY',
      severity: f.error_severity.toUpperCase(),
      confidence: `${f.confidence_score}%`,
      explanation: f.detailed_explanation,
      review_status: f.human_review_status.toUpperCase(),
      notes: f.human_notes || ''
    });
  }

  // 6. Ambiguous Questions Sheet
  const ambSheet = workbook.addWorksheet('Ambiguous Questions');
  ambSheet.columns = allSheet.columns;
  applyHeaderStyle(ambSheet.getRow(1), 'FF0284C7');

  for (const f of findings.filter(x => x.findings_category === 'ambiguous_question' || x.has_stem_error === 1)) {
    ambSheet.addRow({
      q_num: f.question_number,
      subject: f.detected_primary_subject,
      topic: f.topic || 'General',
      stem: f.stem,
      orig_key: f.original_designated_answer || 'N/A',
      prop_key: f.proposed_answer || 'None',
      category: 'AMBIGUOUS / STEM DEFECT',
      severity: f.error_severity.toUpperCase(),
      confidence: `${f.confidence_score}%`,
      explanation: f.stem_evaluation || f.detailed_explanation,
      review_status: f.human_review_status.toUpperCase(),
      notes: f.human_notes || ''
    });
  }

  // 7. Reference Evidence Sheet
  const refSheet = workbook.addWorksheet('Reference Evidence');
  refSheet.columns = [
    { header: 'Q#', key: 'q_num', width: 8 },
    { header: 'Target', key: 'target', width: 14 },
    { header: 'Reference Book', key: 'book', width: 35 },
    { header: 'Printed Page', key: 'print_page', width: 14 },
    { header: 'PDF Page Index', key: 'pdf_page', width: 16 },
    { header: 'Exact Cited Statement / Quotation', key: 'quote', width: 60 },
    { header: 'Support Explanation', key: 'support', width: 50 }
  ];
  applyHeaderStyle(refSheet.getRow(1), 'FF334155');

  for (const c of citations) {
    refSheet.addRow({
      q_num: c.question_number,
      target: c.target_identifier || c.target_type,
      book: c.reference_book_name,
      print_page: c.printed_page_number,
      pdf_page: c.pdf_page_index,
      quote: c.statement_quote,
      support: c.support_explanation
    });
  }

  // 8. Pending Human Review Sheet
  const pendingSheet = workbook.addWorksheet('Pending Human Review');
  pendingSheet.columns = allSheet.columns;
  applyHeaderStyle(pendingSheet.getRow(1), 'FF475569');

  for (const f of findings.filter(x => x.human_review_status === 'pending')) {
    pendingSheet.addRow({
      q_num: f.question_number,
      subject: f.detected_primary_subject,
      topic: f.topic || 'General',
      stem: f.stem,
      orig_key: f.original_designated_answer || 'N/A',
      prop_key: f.proposed_answer || 'None',
      category: f.findings_category.replace(/_/g, ' ').toUpperCase(),
      severity: f.error_severity.toUpperCase(),
      confidence: `${f.confidence_score}%`,
      explanation: f.detailed_explanation,
      review_status: 'PENDING FACULTY REVIEW',
      notes: f.human_notes || ''
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
