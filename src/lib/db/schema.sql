-- Medical Question Auditor & Validator Database Schema

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'reference' | 'examination'
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  subject TEXT,
  category TEXT DEFAULT 'General',
  authors TEXT,
  edition TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded', -- 'uploaded', 'extracting_text', 'running_ocr', 'building_index', 'ready', 'failed', 'requires_attention'
  ocr_confidence_avg REAL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  pdf_page_index INTEGER NOT NULL,
  printed_page_number TEXT,
  extracted_text TEXT NOT NULL,
  has_native_text INTEGER NOT NULL DEFAULT 1,
  ocr_applied INTEGER NOT NULL DEFAULT 0,
  ocr_confidence REAL DEFAULT 100.0,
  page_type TEXT NOT NULL DEFAULT 'digital', -- 'digital', 'scanned', 'mixed'
  word_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  preview_image_path TEXT,
  flagged_uncertain INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_doc_pages_doc ON document_pages(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_pages_num ON document_pages(document_id, pdf_page_index);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES document_pages(id) ON DELETE CASCADE,
  pdf_page_index INTEGER NOT NULL,
  printed_page_number TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  tokens_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_page ON document_chunks(page_id);

CREATE TABLE IF NOT EXISTS examinations (
  id TEXT PRIMARY KEY,
  document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  total_questions INTEGER NOT NULL DEFAULT 0,
  detected_subject_summary TEXT,
  status TEXT NOT NULL DEFAULT 'parsed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL, -- JSON array of { label: string, text: string }
  designated_answer TEXT,
  detected_primary_subject TEXT,
  detected_secondary_subjects TEXT, -- JSON array of strings
  classification_confidence REAL DEFAULT 0,
  topic TEXT,
  source_page_index INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(examination_id);
CREATE INDEX IF NOT EXISTS idx_questions_num ON questions(examination_id, question_number);

CREATE TABLE IF NOT EXISTS audit_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  examination_id TEXT NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'failed'
  progress_percent INTEGER NOT NULL DEFAULT 0,
  current_question_index INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 0,
  confirmed_errors_count INTEGER NOT NULL DEFAULT 0,
  potential_errors_count INTEGER NOT NULL DEFAULT 0,
  multiple_correct_count INTEGER NOT NULL DEFAULT 0,
  no_correct_count INTEGER NOT NULL DEFAULT 0,
  ambiguous_count INTEGER NOT NULL DEFAULT 0,
  insufficient_evidence_count INTEGER NOT NULL DEFAULT 0,
  selected_reference_ids TEXT NOT NULL DEFAULT '[]',
  ai_provider_used TEXT DEFAULT 'built_in',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_findings (
  id TEXT PRIMARY KEY,
  audit_session_id TEXT NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,
  findings_category TEXT NOT NULL, -- 'confirmed_error', 'highly_probable_error', 'potential_error', 'ambiguous_question', 'insufficient_evidence', 'no_detected_issue'
  error_severity TEXT NOT NULL, -- 'critical', 'major', 'moderate', 'minor', 'none'
  confidence_score REAL NOT NULL, -- 0-100%
  stem_evaluation TEXT NOT NULL,
  answer_key_evaluation TEXT NOT NULL,
  original_designated_answer TEXT,
  proposed_answer TEXT,
  proposed_stem TEXT,
  detailed_explanation TEXT NOT NULL,
  has_multiple_correct INTEGER NOT NULL DEFAULT 0,
  has_no_correct INTEGER NOT NULL DEFAULT 0,
  has_stem_error INTEGER NOT NULL DEFAULT 0,
  has_conflicting_references INTEGER NOT NULL DEFAULT 0,
  conflict_explanation TEXT,
  human_review_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'postponed'
  human_notes TEXT,
  human_edited_answer TEXT,
  human_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_findings_session ON audit_findings(audit_session_id);
CREATE INDEX IF NOT EXISTS idx_findings_q ON audit_findings(question_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON audit_findings(human_review_status);

CREATE TABLE IF NOT EXISTS option_analyses (
  id TEXT PRIMARY KEY,
  audit_finding_id TEXT NOT NULL REFERENCES audit_findings(id) ON DELETE CASCADE,
  option_letter TEXT NOT NULL,
  option_text TEXT NOT NULL,
  is_scientifically_correct INTEGER NOT NULL DEFAULT 0,
  is_partially_correct INTEGER NOT NULL DEFAULT 0,
  evaluation_rationale TEXT NOT NULL,
  citation_reference_name TEXT,
  citation_pdf_page INTEGER,
  citation_printed_page TEXT,
  citation_quote TEXT
);

CREATE INDEX IF NOT EXISTS idx_options_finding ON option_analyses(audit_finding_id);

CREATE TABLE IF NOT EXISTS evidence_citations (
  id TEXT PRIMARY KEY,
  audit_finding_id TEXT NOT NULL REFERENCES audit_findings(id) ON DELETE CASCADE,
  reference_book_id TEXT,
  reference_book_name TEXT NOT NULL,
  pdf_page_index INTEGER NOT NULL,
  printed_page_number TEXT,
  statement_quote TEXT NOT NULL,
  context_passage TEXT,
  support_explanation TEXT NOT NULL,
  target_type TEXT NOT NULL, -- 'stem', 'answer_key', 'option', 'conflict'
  target_identifier TEXT, -- 'Option A', 'Stem', etc.
  is_conflicting INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_citations_finding ON evidence_citations(audit_finding_id);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
