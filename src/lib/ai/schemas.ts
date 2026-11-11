export type FindingsCategory =
  | 'confirmed_error'
  | 'highly_probable_error'
  | 'potential_error'
  | 'ambiguous_question'
  | 'insufficient_evidence'
  | 'no_detected_issue';

export type ErrorSeverity =
  | 'critical'
  | 'major'
  | 'moderate'
  | 'minor'
  | 'none';

export interface AIAuditOptionAnalysis {
  option_letter: string;
  is_correct: boolean;
  is_partially_correct: boolean;
  explanation: string;
  citation_book: string;
  citation_page: string;
  citation_pdf_page: number;
  citation_quote: string;
}

export interface AICitation {
  reference_name: string;
  pdf_page_index: number;
  printed_page_number: string;
  quote: string;
  explanation: string;
  target_type: 'stem' | 'answer_key' | 'option' | 'conflict';
  target_identifier: string;
}

export interface AIAuditResponse {
  stem_evaluation: {
    has_scientific_error: boolean;
    has_linguistic_ambiguity: boolean;
    has_contradiction: boolean;
    has_false_premise: boolean;
    details: string;
    proposed_stem_correction?: string;
  };
  answer_key_evaluation: {
    original_designated_answer: string;
    is_original_key_correct: boolean;
    proposed_correct_answers: string[]; // e.g. ['A'], ['B', 'C'], or []
    has_multiple_correct_answers: boolean;
    has_no_correct_answer: boolean;
    rationale: string;
  };
  option_analyses: AIAuditOptionAnalysis[];
  citations: AICitation[];
  findings_category: FindingsCategory;
  error_severity: ErrorSeverity;
  confidence_score: number; // 0 - 100%
  detailed_scientific_explanation: string;
  cross_reference_conflict_detected: boolean;
  conflict_explanation?: string;
}
