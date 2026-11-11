import { getDb } from '@/lib/db';
import { classifyQuestionSubject } from './classifier';
import { retrieveQuestionEvidence } from '@/lib/search/semantic';
import { auditQuestionWithAI } from '@/lib/ai/provider';
import { AIAuditResponse } from '@/lib/ai/schemas';
import { isInvertedPolarityQuestion } from './question-polarity';
import crypto from 'node:crypto';

export interface AuditProgressUpdate {
  currentQuestion: number;
  totalQuestions: number;
  progressPercent: number;
  lastFinding?: any;
}

const VALID_CATEGORIES = new Set([
  'confirmed_error',
  'highly_probable_error',
  'potential_error',
  'ambiguous_question',
  'insufficient_evidence',
  'no_detected_issue'
]);

const VALID_SEVERITIES = new Set(['critical', 'major', 'moderate', 'minor', 'none']);

const VALID_TARGET_TYPES = new Set(['stem', 'answer_key', 'option', 'conflict']);

/**
 * Normalize external LLM response so missing/inconsistent fields or inverted-polarity
 * boolean flips cannot corrupt SQLite records or report false errors.
 */
export function sanitizeAiResponse(
  raw: AIAuditResponse,
  designatedAnswer: string,
  stem: string = '',
  hasMcqOptions: boolean = true
): AIAuditResponse {
  const category = VALID_CATEGORIES.has(raw?.findings_category)
    ? raw.findings_category
    : 'potential_error';

  const severity = VALID_SEVERITIES.has(raw?.error_severity)
    ? raw.error_severity
    : (category === 'no_detected_issue' ? 'none' : 'moderate');

  let confidence = Number(raw?.confidence_score);
  if (!Number.isFinite(confidence)) confidence = 75;
  if (confidence > 0 && confidence <= 1) confidence = Math.round(confidence * 100);
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  const stemEval = raw?.stem_evaluation || ({} as any);
  const ansEval = raw?.answer_key_evaluation || ({} as any);
  let optionAnalyses: AIAuditResponse['option_analyses'] = Array.isArray(raw?.option_analyses)
    ? raw.option_analyses.map((o: any) => ({
        option_letter: String(o?.option_letter || '').trim().replace(/^option\s+/i, '').toUpperCase().slice(0, 2) || 'A',
        is_correct: Boolean(o?.is_correct),
        is_partially_correct: Boolean(o?.is_partially_correct),
        explanation: String(o?.explanation || 'Evaluated against reference excerpts.'),
        citation_book: String(o?.citation_book || 'None'),
        citation_page: String(o?.citation_page ?? 'N/A'),
        citation_pdf_page: Number.isFinite(Number(o?.citation_pdf_page)) ? Number(o?.citation_pdf_page) : 0,
        citation_quote: String(o?.citation_quote || '')
      }))
    : [];

  let proposedAnswers: string[] = Array.isArray(ansEval.proposed_correct_answers)
    ? ansEval.proposed_correct_answers
        .map((x: any) => {
          const s = String(x || '').trim();
          return hasMcqOptions ? s.replace(/^option\s+/i, '').toUpperCase() : s;
        })
        .filter(Boolean)
    : [];

  let finalCategory = category;
  let finalSeverity = severity;
  let hasMulti = Boolean(ansEval.has_multiple_correct_answers);
  let hasNoCorrect = Boolean(ansEval.has_no_correct_answer);
  let isOrigCorrect = Boolean(ansEval.is_original_key_correct);
  const desNorm = (designatedAnswer || '').trim().replace(/^option\s+/i, '').toUpperCase();
  const hasValidDesignatedKey = Boolean(desNorm && !/^(?:NOT\s+PROVIDED|NONE|N\/A)$/i.test(desNorm));
  const isInverted = isInvertedPolarityQuestion(stem);

  // 1. Inverted-Polarity Guard (EXCEPT / NOT / FALSE / LEAST):
  // Recover cleanly if LLM set option_analyses.is_correct=true on true statements and false on the winning exception.
  if (isInverted && optionAnalyses.length >= 2 && finalCategory !== 'insufficient_evidence') {
    const trueOpts = optionAnalyses.filter(o => o.is_correct);
    const falseOpts = optionAnalyses.filter(o => !o.is_correct);
    const rationaleStr = String(ansEval.rationale || raw?.detailed_scientific_explanation || '');

    const explicitComplementMatch =
      proposedAnswers.length === 1 &&
      falseOpts.some(f => f.option_letter === proposedAnswers[0].toUpperCase()) &&
      trueOpts.length >= 2;

    const singleExceptionObj = falseOpts.length === 1 ? falseOpts[0] : undefined;
    const implicitTruthfulnessFlip =
      Boolean(singleExceptionObj) &&
      trueOpts.length === optionAnalyses.length - 1 &&
      (
        (ansEval.is_original_key_correct && hasValidDesignatedKey && desNorm === singleExceptionObj!.option_letter) ||
        /\b(?:false|incorrect|wrong|exception|does\s+not|is\s+not|not\s+true|not\s+belong|correct\s+(?:choice|answer|option)\s+for\s+(?:an?\s+)?['"]?(?:except|not))\b/i.test(singleExceptionObj!.explanation) ||
        new RegExp(`\\b(?:option\\s+)?${singleExceptionObj!.option_letter}\\b.{0,80}\\b(?:is\\s+false|false\\s+statement|correct\\s+(?:choice|answer)|exception)\\b`, 'i').test(rationaleStr)
      );

    if (explicitComplementMatch || implicitTruthfulnessFlip) {
      optionAnalyses = optionAnalyses.map(o => ({ ...o, is_correct: !o.is_correct }));
      proposedAnswers = explicitComplementMatch
        ? [proposedAnswers[0].toUpperCase()]
        : [singleExceptionObj!.option_letter];
      hasMulti = false;
      hasNoCorrect = false;
    }
  }

  // 2. Empty-citation "has_no_correct_answer" -> downgrade to "insufficient_evidence"
  const citationsList = Array.isArray(raw?.citations) ? raw.citations : [];
  const hasRealOptionCitation = optionAnalyses.some(
    o => o.citation_quote.trim().length > 12 && !/^(?:none|not provided|unavailable)$/i.test(o.citation_book.trim()) && !/not provided/i.test(o.citation_quote)
  );
  const hasRealTopCitation = citationsList.some(
    (c: any) => String(c?.quote || '').trim().length > 12 && !/^(?:none|not provided|unavailable)$/i.test(String(c?.reference_name || '').trim())
  );
  if (hasNoCorrect && proposedAnswers.length === 0 && !hasRealOptionCitation && !hasRealTopCitation) {
    finalCategory = 'insufficient_evidence';
    finalSeverity = 'none';
    hasNoCorrect = false;
    isOrigCorrect = true;
  }

  // 3. Cross-check option_analyses vs proposed_correct_answers to eliminate contradictions
  if (optionAnalyses.length > 0 && finalCategory !== 'insufficient_evidence') {
    const validOptionSet = new Set(optionAnalyses.filter(o => o.is_correct).map(o => o.option_letter.toUpperCase()));
    if (validOptionSet.size > 0 && proposedAnswers.length > 0) {
      const intersection = proposedAnswers.filter(a => validOptionSet.has(a.toUpperCase()));
      if (intersection.length > 0) {
        proposedAnswers = Array.from(new Set(intersection.map(x => x.toUpperCase())));
      } else {
        proposedAnswers = Array.from(validOptionSet);
      }
    } else if (validOptionSet.size > 0 && proposedAnswers.length === 0) {
      proposedAnswers = Array.from(validOptionSet);
    }

    hasMulti = proposedAnswers.length > 1;
    const stemDefect = Boolean(stemEval.has_scientific_error) || Boolean(stemEval.has_linguistic_ambiguity);

    if (
      hasValidDesignatedKey &&
      proposedAnswers.length === 1 &&
      proposedAnswers[0].toUpperCase() === desNorm &&
      !hasMulti &&
      !hasNoCorrect &&
      !stemDefect
    ) {
      isOrigCorrect = true;
      if (finalCategory === 'confirmed_error' || finalCategory === 'highly_probable_error' || finalCategory === 'potential_error') {
        finalCategory = 'no_detected_issue';
        finalSeverity = 'none';
      }
    } else if (
      hasValidDesignatedKey &&
      /^[A-E]$/.test(desNorm) &&
      !isOrigCorrect &&
      finalCategory === 'confirmed_error' &&
      confidence < 85
    ) {
      finalCategory = 'potential_error';
      finalSeverity = 'moderate';
    }
  }

  return {
    stem_evaluation: {
      has_scientific_error: Boolean(stemEval.has_scientific_error),
      has_linguistic_ambiguity: Boolean(stemEval.has_linguistic_ambiguity),
      has_contradiction: Boolean(stemEval.has_contradiction),
      has_false_premise: Boolean(stemEval.has_false_premise),
      details: String(stemEval.details || 'Question stem audited against reference literature.'),
      proposed_stem_correction: stemEval.proposed_stem_correction ? String(stemEval.proposed_stem_correction) : undefined
    },
    answer_key_evaluation: {
      original_designated_answer: String(ansEval.original_designated_answer ?? designatedAnswer ?? ''),
      is_original_key_correct: isOrigCorrect,
      proposed_correct_answers: proposedAnswers,
      has_multiple_correct_answers: hasMulti,
      has_no_correct_answer: hasNoCorrect,
      rationale: String(ansEval.rationale || raw?.detailed_scientific_explanation || 'Evaluated using reference excerpts.')
    },
    option_analyses: optionAnalyses,
    citations: citationsList.map((c: any) => ({
      reference_name: String(c?.reference_name || 'Uploaded Reference'),
      pdf_page_index: Number.isFinite(Number(c?.pdf_page_index)) ? Number(c?.pdf_page_index) : 0,
      printed_page_number: String(c?.printed_page_number ?? 'N/A'),
      quote: String(c?.quote || ''),
      explanation: String(c?.explanation || ''),
      target_type: VALID_TARGET_TYPES.has(c?.target_type) ? c.target_type : 'option',
      target_identifier: String(c?.target_identifier || 'General')
    })),
    findings_category: finalCategory,
    error_severity: finalSeverity,
    confidence_score: confidence,
    detailed_scientific_explanation: String(raw?.detailed_scientific_explanation || ansEval.rationale || 'Audit completed.'),
    cross_reference_conflict_detected: Boolean(raw?.cross_reference_conflict_detected),
    conflict_explanation: raw?.conflict_explanation ? String(raw.conflict_explanation) : undefined
  };
}

/**
 * Executes a full scientific audit session question by question (batched for external LLMs)
 */
export async function executeAuditSession(
  sessionId: string,
  onProgress?: (progress: AuditProgressUpdate) => void
): Promise<void> {
  const db = getDb();

  const session = db.prepare(`
    SELECT id, examination_id, selected_reference_ids, ai_provider_used
    FROM audit_sessions
    WHERE id = ?
  `).get(sessionId) as {
    id: string;
    examination_id: string;
    selected_reference_ids: string;
    ai_provider_used: string;
  } | undefined;

  if (!session) {
    throw new Error(`Audit session ${sessionId} not found`);
  }

  let selectedRefIds: string[] = [];
  try {
    selectedRefIds = JSON.parse(session.selected_reference_ids || '[]');
  } catch {
    selectedRefIds = [];
  }

  if (selectedRefIds.length === 0) {
    const readyBooks = db.prepare("SELECT id FROM documents WHERE type = 'reference' AND status = 'ready'").all() as Array<{ id: string }>;
    selectedRefIds = readyBooks.map(b => b.id);
  }

  const allReadyBooks = db.prepare("SELECT id, title, subject FROM documents WHERE type = 'reference' AND status = 'ready'").all() as Array<{ id: string; title: string; subject: string }>;

  const questions = db.prepare(`
    SELECT id, question_number, stem, options_json, designated_answer
    FROM questions
    WHERE examination_id = ?
    ORDER BY question_number ASC
  `).all(session.examination_id) as Array<{
    id: string;
    question_number: number;
    stem: string;
    options_json: string;
    designated_answer: string;
  }>;

  const totalQuestions = questions.length;
  if (totalQuestions === 0) {
    db.prepare("UPDATE audit_sessions SET status = 'completed', progress_percent = 100, completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
    return;
  }

  db.prepare(`
    UPDATE audit_sessions
    SET status = 'in_progress', total_questions = ?, current_question_index = 0, progress_percent = 0
    WHERE id = ?
  `).run(totalQuestions, sessionId);

  db.prepare("DELETE FROM audit_findings WHERE audit_session_id = ?").run(sessionId);

  const insertFinding = db.prepare(`
    INSERT INTO audit_findings (
      id, audit_session_id, question_id, question_number, findings_category, error_severity,
      confidence_score, stem_evaluation, answer_key_evaluation, original_designated_answer,
      proposed_answer, proposed_stem, detailed_explanation, has_multiple_correct,
      has_no_correct, has_stem_error, has_conflicting_references, conflict_explanation,
      human_review_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  const insertOptionAnalysis = db.prepare(`
    INSERT INTO option_analyses (
      id, audit_finding_id, option_letter, option_text, is_scientifically_correct,
      is_partially_correct, evaluation_rationale, citation_reference_name, citation_pdf_page,
      citation_printed_page, citation_quote
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCitation = db.prepare(`
    INSERT INTO evidence_citations (
      id, audit_finding_id, reference_book_id, reference_book_name, pdf_page_index,
      printed_page_number, statement_quote, support_explanation, target_type, target_identifier,
      is_conflicting
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateQuestionClassification = db.prepare(`
    UPDATE questions
    SET detected_primary_subject = ?, detected_secondary_subjects = ?, classification_confidence = ?, topic = ?
    WHERE id = ?
  `);

  let confirmedErrorsCount = 0;
  let potentialErrorsCount = 0;
  let multipleCorrectCount = 0;
  let noCorrectCount = 0;
  let ambiguousCount = 0;
  let insufficientEvidenceCount = 0;

  const providerMode = session.ai_provider_used || 'built_in';
  // For external LLMs: process ONE question at a time sequentially with a minimum inter-request delay
  // to avoid simultaneous bursts across the small free-tier RPM quotas of Gemini Lite models.
  // batchSize=1 ensures that every question is fully committed to DB before the next API call begins.
  const batchSize = 1;
  // Minimum delay between consecutive external API calls (ms). At 15 RPM free tier,
  // one request every 4 seconds is a safe pace. The adaptive cooldown in provider.ts handles
  // actual 429s when they occur by waiting out the retry window.
  const interQuestionDelayMs = providerMode === 'built_in' ? 0 : 1500;
  let completedCount = 0;

  for (let start = 0; start < totalQuestions; start += batchSize) {
    const batch = questions.slice(start, start + batchSize);

    // Run subject classification, cross-book evidence retrieval, and AI verification sequentially
    const evaluatedBatch = await Promise.all(
      batch.map(async (q) => {
        let options: Array<{ label: string; text: string }> = [];
        try {
          options = JSON.parse(q.options_json);
        } catch {
          options = [];
        }

        const classification = await classifyQuestionSubject(q.stem, options, allReadyBooks);
        // Always search across ALL selected books while prioritizing subject-matched books
        const evidenceBundle = await retrieveQuestionEvidence(
          q.stem,
          options,
          selectedRefIds,
          classification.matchedReferenceBookIds
        );
        const rawAiResult = await auditQuestionWithAI(q.stem, options, q.designated_answer, evidenceBundle, providerMode);
        const aiResult = sanitizeAiResponse(rawAiResult, q.designated_answer || '', q.stem, options.length > 0);

        return { q, options, classification, aiResult };
      })
    );

    // Persist batch results synchronously in order (safe for node:sqlite)
    for (const { q, options, classification, aiResult } of evaluatedBatch) {
      updateQuestionClassification.run(
        classification.primarySubject,
        JSON.stringify(classification.secondarySubjects),
        classification.confidence,
        classification.topic,
        q.id
      );

      if (aiResult.findings_category === 'confirmed_error') confirmedErrorsCount++;
      if (aiResult.findings_category === 'potential_error') potentialErrorsCount++;
      if (aiResult.findings_category === 'ambiguous_question') ambiguousCount++;
      if (aiResult.findings_category === 'insufficient_evidence') insufficientEvidenceCount++;
      if (aiResult.answer_key_evaluation.has_multiple_correct_answers) multipleCorrectCount++;
      if (aiResult.answer_key_evaluation.has_no_correct_answer) noCorrectCount++;

      const findingId = crypto.randomUUID();
      insertFinding.run(
        findingId,
        sessionId,
        q.id,
        q.question_number,
        aiResult.findings_category,
        aiResult.error_severity,
        aiResult.confidence_score,
        aiResult.stem_evaluation.details,
        aiResult.answer_key_evaluation.rationale,
        aiResult.answer_key_evaluation.original_designated_answer || null,
        aiResult.answer_key_evaluation.proposed_correct_answers.join(', '),
        aiResult.stem_evaluation.proposed_stem_correction || null,
        aiResult.detailed_scientific_explanation,
        aiResult.answer_key_evaluation.has_multiple_correct_answers ? 1 : 0,
        aiResult.answer_key_evaluation.has_no_correct_answer ? 1 : 0,
        aiResult.stem_evaluation.has_scientific_error ? 1 : 0,
        aiResult.cross_reference_conflict_detected ? 1 : 0,
        aiResult.conflict_explanation || null
      );

      for (const optAnalysis of aiResult.option_analyses) {
        const optId = crypto.randomUUID();
        const originalOpt = options.find(o => o.label.toUpperCase() === optAnalysis.option_letter.toUpperCase());
        insertOptionAnalysis.run(
          optId,
          findingId,
          optAnalysis.option_letter,
          originalOpt ? originalOpt.text : '',
          optAnalysis.is_correct ? 1 : 0,
          optAnalysis.is_partially_correct ? 1 : 0,
          optAnalysis.explanation,
          optAnalysis.citation_book,
          optAnalysis.citation_pdf_page,
          optAnalysis.citation_page,
          optAnalysis.citation_quote
        );
      }

      for (const citation of aiResult.citations) {
        const citeId = crypto.randomUUID();
        insertCitation.run(
          citeId,
          findingId,
          null,
          citation.reference_name,
          citation.pdf_page_index,
          citation.printed_page_number,
          citation.quote,
          citation.explanation,
          citation.target_type,
          citation.target_identifier,
          0
        );
      }

      completedCount++;
      const currentProgress = Math.round((completedCount / totalQuestions) * 100);
      db.prepare(`
        UPDATE audit_sessions
        SET current_question_index = ?, progress_percent = ?,
            confirmed_errors_count = ?, potential_errors_count = ?,
            multiple_correct_count = ?, no_correct_count = ?,
            ambiguous_count = ?, insufficient_evidence_count = ?
        WHERE id = ?
      `).run(
        completedCount,
        currentProgress,
        confirmedErrorsCount,
        potentialErrorsCount,
        multipleCorrectCount,
        noCorrectCount,
        ambiguousCount,
        insufficientEvidenceCount,
        sessionId
      );

      onProgress?.({
        currentQuestion: completedCount,
        totalQuestions,
        progressPercent: currentProgress,
        lastFinding: {
          questionNumber: q.question_number,
          category: aiResult.findings_category,
          severity: aiResult.error_severity,
          proposedAnswer: aiResult.answer_key_evaluation.proposed_correct_answers.join(', ')
        }
      });
    }

    // Pace external API calls: wait at least interQuestionDelayMs between questions.
    // If provider.ts also needed to wait for 429 cooldown (which inflates the per-call time),
    // the minimum delay here still provides baseline RPM protection.
    if (interQuestionDelayMs > 0 && start + batchSize < totalQuestions) {
      await new Promise(r => setTimeout(r, interQuestionDelayMs));
    }
  }

  db.prepare(`
    UPDATE audit_sessions
    SET status = 'completed', progress_percent = 100, completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(sessionId);
}
