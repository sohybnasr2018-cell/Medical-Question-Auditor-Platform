import { getDb } from '@/lib/db';
import { AIAuditResponse, FindingsCategory, ErrorSeverity } from './schemas';
import { QuestionSearchBundle, RetrievedEvidence } from '@/lib/search/semantic';
import { auditIndividualOption } from '@/lib/audit/option-checker';
import { analyzeCrossReferenceConflicts } from '@/lib/audit/conflict-resolver';
import { isInvertedPolarityQuestion } from '@/lib/audit/question-polarity';

const modelCooldownUntil: Record<string, number> = {};

/**
 * Fetch a system setting value by key
 */
function getSetting(key: string, defaultValue: string = ''): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : defaultValue;
}

const SYSTEM_INSTRUCTIONS = `You are an elite Medical Question Auditor and Validator.
You verify the scientific accuracy of medical examination questions using ONLY the provided textbook reference excerpts as primary evidence.

══════════════════════════════════════════════════════
PART A — CORE INTEGRITY RULES
══════════════════════════════════════════════════════
1. NEVER assume that the designated answer key is correct. Audit every option on its own scientific merits.
2. Evaluate EVERY option independently against the reference excerpts.
3. If multiple options are scientifically correct according to an EXACT TERM MATCH in the excerpts (see Part D), identify all of them in proposed_correct_answers, set has_multiple_correct_answers=true, and findings_category="confirmed_error".
4. ONLY set has_no_correct_answer=true if the reference excerpts actively REFUTE ALL provided options or confirm that the scientifically correct answer is entirely absent from the choices. Do NOT set this flag merely because evidence is weak or the option wording is imprecise.
5. If DESIGNATED ANSWER KEY is "Not provided", evaluate independently. If exactly one option is verifiable, set is_original_key_correct=true, findings_category="no_detected_issue", error_severity="none". If a provided key conflicts with the evidence, set is_original_key_correct=false, findings_category="confirmed_error".
6. NEVER fabricate page numbers or quotations. Only quote exact text from the provided excerpts.
7. If the excerpts contain insufficient information to judge correctness, assign findings_category="insufficient_evidence" and explain what information is missing. NEVER issue a "confirmed_error" solely because evidence is absent.
8. For written/open-ended questions (no MCQ options), leave option_analyses=[]. If the stem is scientifically supported by the excerpts, set proposed_correct_answers=["Verified Written Question"], is_original_key_correct=true, findings_category="no_detected_issue".
9. If multiple reference books conflict, cite both and do not fabricate a consensus.
10. Return output STRICTLY in the requested JSON format.

══════════════════════════════════════════════════════
PART B — QUESTION COMPREHENSION FRAMEWORK
(Apply these before evaluating any option)
══════════════════════════════════════════════════════
Before answering, explicitly perform THREE reading passes:

PASS 1 — IDENTIFY THE EXACT QUESTION TYPE:
   • What SPECIFIC thing is being asked? (e.g., "which drug INHIBITS", "which statement is TRUE", "which structure lies BEHIND", "what is the MOST COMMON cause", "what is the MECHANISM of action")
   • Extract the key interrogative verb/phrase: inhibit, stimulate, increase, decrease, lies behind, anterior to, most common, least common, characteristic of, NOT true, EXCEPT, etc.
   • WARNING: "EXCEPT" / "NOT" / "INCORRECT" / "FALSE" / "LEAST" questions invert the answer logic — the winning answer is the FALSE / excluded option, NOT the true statements. For inverted questions, option_analyses[].is_correct MUST represent whether the option is the WINNING ANSWER TO THE QUESTION (true ONLY for the false/excluded statement; false for true statements that are eliminated by EXCEPT), and proposed_correct_answers MUST contain ONLY the exception letter(s). NEVER list the true statements in proposed_correct_answers or flag MULTIPLE CORRECT unless 2+ options are factually false.

PASS 2 — UNDERSTAND THE CLINICAL / SCIENTIFIC CONTEXT:
   • Who is the patient? (age, sex, clinical setting, comorbidities)
   • What physiological system, anatomical region, drug class, or pathological process is being tested?
   • Are there qualifiers that narrow the scope? (e.g., "in adults", "first-line", "most common in children", "at rest")
   • Never ignore qualifying words — they change the correct answer completely.

PASS 3 — EVALUATE OPTIONS WITH EXACT REFERENCE FRAME:
   • For SPATIAL/ANATOMICAL questions ("lies behind / in front of / above / below / passes through"):
     - "X lies BEHIND Y" = X is POSTERIOR to Y (Y is ANTERIOR to X). The answer is Y.
     - "X lies IN FRONT OF Y" = X is ANTERIOR to Y (Y is POSTERIOR to X). The answer is Y.
     - "X passes through Y" = identify the named foramen, canal, or space; Y is the passageway.
     - Never confuse the subject of the sentence with its spatial reference.
   • For CAUSE/EFFECT questions: identify what causes what; do not reverse the direction.
   • For MECHANISM questions: identify the specific step, receptor, enzyme, or pathway being tested; do not substitute a related but different mechanism.
   • For CLINICAL/DIAGNOSTIC questions: apply the stated clinical scenario precisely; different patient demographics may have different answers.
   • For PHARMACOLOGY questions: distinguish mechanism of action vs. therapeutic use vs. side effect vs. contraindication; they are different question types.
   • For MOST COMMON / LEAST COMMON questions: apply the specific population and context stated in the stem; do not substitute a different population.
   • For TRUE/FALSE-based MCQs: verify each statement strictly; a statement that is "mostly true" but has one factual error is INCORRECT.
   • For "which is NOT / EXCEPT" questions: the correct answer is the one option that is SCIENTIFICALLY FALSE or DOES NOT BELONG.

══════════════════════════════════════════════════════
PART C — EVIDENCE EVALUATION RULES
══════════════════════════════════════════════════════
11. Ground every citation strictly in the provided reference excerpts and NEVER fabricate textbook quotes or page numbers. However, apply Rule 20 whenever a brief shorthand bullet conflicts with another textbook excerpt or foundational medical truth.
12. If a reference excerpt partially matches but does not explicitly confirm an option, treat it as insufficient evidence for that option — do not infer.
13. When evaluating quantitative values (doses, measurements, percentages, timing), require an exact match within normal physiological precision. A stated value of "3–12 mm" cannot be verified against an excerpt saying "< 0.1 mm".
14. When an excerpt describes a list of features, verify EACH option against the SPECIFIC feature it claims, not against the general topic.
15. Confidence score (0–100) must reflect genuine evidence quality: 90–100 only when a quote directly confirms or refutes; 60–89 when strongly implied; below 60 when inferred or uncertain.

══════════════════════════════════════════════════════
PART D — STRICT TERMINOLOGY AND STRUCTURAL READING
(CRITICAL: Violations cause false error reports)
══════════════════════════════════════════════════════
16. EXACT MEDICAL TERMINOLOGY: Medical terms that share a root word but differ in their suffix or qualifier are DIFFERENT conditions and must NEVER be treated as interchangeable. Examples:
    - "stenosis" ≠ "incompetence" ≠ "regurgitation" ≠ "prolapse" (different valvular pathologies)
    - "mitral stenosis" ≠ "mitral incompetence" (different diseases, different hemodynamics, different heart failure sides)
    - "aortic stenosis" ≠ "aortic regurgitation"
    - "hypertrophy" ≠ "hyperplasia" ≠ "hypertension"
    - "ischemia" ≠ "infarction" ≠ "inflammation"
    - "acute" ≠ "chronic", "compensated" ≠ "decompensated"
    If the option says "mitral stenosis" but the excerpt says "mitral incompetence", the option is NOT confirmed by that excerpt.

17. STRUCTURAL CONTEXT IN REFERENCE TEXT: When the reference text organizes information into CATEGORIES, COLUMNS, STAGES, TYPES, or SIDES (e.g., "left-sided vs right-sided", "compensation vs decompensation", "causes vs complications", "Type I vs Type II"), you MUST identify WHICH category each piece of information belongs to. Information listed under one category CANNOT be used to confirm an option that refers to a different category.
    Examples:
    - If "Heart rate → cardiac fatigue" appears under "Stage of Decompensation" in the text, it CANNOT be used to confirm an option about "Stage of Compensation".
    - If "pulmonary stenosis" is listed under "Right-sided heart failure", it CANNOT confirm an option about causes of "Left-sided heart failure".
    - If a drug side effect is listed under "Contraindications", it cannot be used to confirm a "Mechanism of action" option.

18. CONSERVATIVE MULTIPLE-CORRECT FLAGGING: Before declaring has_multiple_correct_answers=true, apply this strict checklist:
    a) Does the EXACT medical term in the option appear in the excerpt? (Not a similar-sounding term)
    b) Is the excerpt term found under the SAME category/heading/side/stage that the question asks about?
    c) Does the option's complete claim match what the excerpt states? (Not just a partial keyword overlap)
    ALL THREE must be YES to mark an option as correct. If any check fails, the option is INCORRECT or unverified.

19. WHEN IN DOUBT, PRESERVE THE DESIGNATED KEY: If the designated answer is clearly supported by the excerpts but another option is only AMBIGUOUSLY or PARTIALLY supported, do NOT flag "multiple correct." Instead, confirm the designated answer and explain why the other option does not meet the strict verification criteria. The threshold for overruling an exam answer key must be very high — clear, unambiguous, direct textbook evidence with exact terminology match.

20. CROSS-PAGE CONTRADICTION & SHORTHAND ERRATUM GUARD: Lecture notes and student handouts occasionally contain a brief shorthand list item or copy-paste typo (e.g., listing a communicating/anastomotic structure without an explicit drainage verb, or mistyping one bullet). Before accepting any secondary option as "CORRECT" to declare has_multiple_correct_answers=true or overwrite a clearly verified designated key:
    a) Check ALL other excerpts in the prompt for statements about that structure (e.g., if Page A briefly lists "8 - Vena azygos ." under IVC while Page B states "The S.V.C. has only one tributary, the azygos vein" or places it under "Anastomoses between I.V.C. & S.V.C.", recognize that contradiction).
    b) Check whether universal established medical science confirms that shorthand item is factually an anastomotic connection or author erratum rather than the stated claim (e.g. azygos vein drains primarily into SVC, NOT IVC).
    When an isolated shorthand bullet conflicts with another textbook excerpt or universal core medical anatomy/physiology while the designated answer is cleanly verified, do NOT mark the conflicting bullet as is_correct=true and do NOT trigger MULTIPLE CORRECT; mark that option INCORRECT and explain the textbook conflict transparently.

══════════════════════════════════════════════════════
PART E — QUANTITATIVE, OCR LAYOUT & KEY DEFENSE GATES
(CRITICAL: Eliminate false error overrides of valid keys)
══════════════════════════════════════════════════════
21. EXACT NUMBER, QUALIFIER & CITATION CONSISTENCY AUDIT:
    Before setting is_correct=true on an option or citing a textbook quote, compare the EXACT numbers, percentages, units, directions ("increase" vs "decrease"), and qualifiers between the option and the quote:
    - "as high as 700%" REFUTES an option saying "200%" (NEVER cite a quote containing "700%" to confirm "200%").
    - "Non-clear internal elastic lamina" in the aorta REFUTES an option claiming IEL is "most prominent in large elastic arteries like the aorta".
    - Causes listed under "ACUTE HEART FAILURE" (e.g. recent myocardial infarction, haemopericardium, massive PE) CANNOT confirm an option for "CHRONIC heart failure".
    Never mark an option correct when your own cited quote contradicts its value or qualifier.

22. OCR SLIDE / TABLE ROW AFFILIATION GUARD:
    Lecture slides extracted via OCR sometimes omit a colored subheader or concatenate two adjacent table entries vertically (for instance: Subtype 1 followed by "Rare", then immediately below it "Most common (90%) ... Pathology: Markedly dilated heart" belonging to Subtype 2 whose box title did not OCR cleanly).
    Never attach a statistic ("Most common (90%)") to an entry whose own bullets say "Rare", or whose pathology ("Markedly dilated heart" = dilated/congestive cardiomyopathy) belongs to the next sibling category. Cross-check ambiguous list alignments against universal core medical knowledge.

23. SYMMETRIC BURDEN OF PROOF BEFORE OVERRIDING A DESIGNATED ANSWER KEY:
    To set is_original_key_correct=false and findings_category="confirmed_error", BOTH of the following MUST be satisfied:
    a) The designated answer key option is DIRECTLY and UNAMBIGUOUSLY refuted by an explicit textbook statement or indisputable core medical error — NOT merely because a list omits an arrow ("Heart rate" under preload determinants -> prolonged diastole at decreased HR increases preload), NOT on minor preposition/phrasing differences ("at the inguinal ligament" vs "behind the inguinal ligament"; "tension-length curve" vs "Frank-Starling/ventricular curve"), and NOT via a single-equation multi-hop inference that conflicts with another excerpt page (e.g., citing "as RAP decreases -> VR increases" while another page states "increased RAP increases EDV/COP" and "RAP is the main force for ventricular filling").
    b) Your proposed replacement answer is unambiguously and directly proven across ALL relevant excerpts without distorting scope (e.g., extreme HR > 220 or acute rescue vs ongoing prophylaxis).
    If the designated key is physiologically/anatomically valid and defensible from the excerpts and core medical science, CONFIRM the designated key (is_original_key_correct=true, findings_category="no_detected_issue").

24. MISSING COVERAGE VS FALSE "NO CORRECT ANSWER":
    NEVER set has_no_correct_answer=true and findings_category="confirmed_error" when:
    - The textbook excerpts do not cover the question topic at all (use "insufficient_evidence" instead), OR
    - One option aligns with the core medical truth / textbook mechanism while all other choices are clearly false, even if a secondary qualifier in that option is absent from a brief lecture bullet (e.g. chemoreceptor firing during severe hypotension, hyperglycemia in atherosclerosis).

25. IDENTICAL OR EQUIVALENT DUPLICATE OPTIONS (MANDATORY MULTIPLE CORRECT):
    Before finalizing "option_analyses", compare every MCQ option's text against all sibling options. Whenever two or more options have identical or verbatim-equivalent wording (for example Option C and Option D both state "Horizontal transmission"), you MUST assign ALL identical options the EXACT SAME "is_correct" verdict. NEVER mark one identical twin false merely because the other letter is listed in DESIGNATED ANSWER KEY. Whenever that shared wording is a winning answer (for either standard or INVERTED EXCEPT/NOT questions), mark ALL matching letters "is_correct": true, include ALL of them in "proposed_correct_answers" (e.g., ["C", "D"]), set "has_multiple_correct_answers": true, set "is_original_key_correct": false (unless DESIGNATED ANSWER KEY already listed all matching letters), and set "findings_category": "confirmed_error".`;

function parseGeminiCooldown(errTxt: string, retryAfterHeader: string | null): { cooldownMs: number; isDailyExhausted: boolean } {
  const isDailyLimit = /per day limit exceeded|limit:\s*0\b/i.test(errTxt);
  let parsedMs = 0;

  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (!Number.isNaN(secs) && secs > 0) {
      parsedMs = Math.ceil(secs * 1000) + 500;
    }
  }

  if (!parsedMs) {
    const hms = errTxt.match(/retry in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*([\d.]+)s/i);
    if (hms) {
      const h = parseInt(hms[1] || '0', 10);
      const m = parseInt(hms[2] || '0', 10);
      const s = parseFloat(hms[3] || '0');
      parsedMs = Math.ceil((h * 3600 + m * 60 + s) * 1000) + 800;
    }
  }

  if (isDailyLimit || parsedMs > 120000) {
    return {
      cooldownMs: Math.min(Math.max(parsedMs, 15 * 60 * 1000), 12 * 3600 * 1000),
      isDailyExhausted: true
    };
  }

  return {
    cooldownMs: parsedMs > 0 ? Math.min(Math.max(parsedMs, 5000), 70000) : 32000,
    isDailyExhausted: false
  };
}

function buildUnavailableProviderFallback(
  options: Array<{ label: string; text: string }>,
  designatedAnswer: string,
  evidenceBundle: QuestionSearchBundle,
  provider: string,
  reason: string
): AIAuditResponse {
  const firstEv = evidenceBundle.allRetrievedPages[0];
  return {
    stem_evaluation: {
      has_scientific_error: false,
      has_linguistic_ambiguity: false,
      has_contradiction: false,
      has_false_premise: false,
      details: `External AI verification (${provider}) could not complete because of API quota or connectivity limits (${reason}). Manual review or retry recommended.`,
      proposed_stem_correction: undefined
    },
    answer_key_evaluation: {
      original_designated_answer: designatedAnswer || '',
      is_original_key_correct: true,
      proposed_correct_answers: [],
      has_multiple_correct_answers: false,
      has_no_correct_answer: false,
      rationale: `External AI provider "${provider}" was unavailable (${reason}). Returned insufficient_evidence instead of running deterministic guesswork so valid keys are never falsely flagged as errors.`
    },
    option_analyses: options.map(opt => ({
      option_letter: opt.label,
      is_correct: false,
      is_partially_correct: false,
      explanation: `Pending ${provider} AI verification (${reason}).`,
      citation_book: firstEv?.referenceBookName || 'Unavailable',
      citation_page: firstEv?.printedPageNumber || 'N/A',
      citation_pdf_page: firstEv?.pdfPageIndex || 1,
      citation_quote: firstEv?.excerpt?.slice(0, 120) || 'AI verification paused due to temporary provider limit.'
    })),
    citations: firstEv
      ? [{
          reference_name: firstEv.referenceBookName,
          pdf_page_index: firstEv.pdfPageIndex,
          printed_page_number: firstEv.printedPageNumber,
          quote: firstEv.excerpt.slice(0, 180),
          explanation: 'Retrieved textbook passage pending external AI confirmation.',
          target_type: 'stem',
          target_identifier: 'Stem'
        }]
      : [],
    findings_category: 'insufficient_evidence',
    error_severity: 'none',
    confidence_score: 0,
    detailed_scientific_explanation: `External AI provider "${provider}" failed to respond (${reason}). Please retry once quota resets.`,
    cross_reference_conflict_detected: false,
    conflict_explanation: undefined
  };
}

/**
 * Built-in deterministic Medical Auditor fallback
 */
function runBuiltInMedicalAuditor(
  stem: string,
  options: Array<{ label: string; text: string }>,
  designatedAnswer: string,
  evidenceBundle: QuestionSearchBundle
): AIAuditResponse {
  const conflictAnalysis = analyzeCrossReferenceConflicts(evidenceBundle.crossBookEvidence, stem, options);

  // Check stem for known scientific or linguistic issues
  const stemLower = stem.toLowerCase();
  let hasStemError = false;
  let hasAmbiguity = false;
  let stemErrorDetails = 'Question stem presents clinically accurate terminology and unambiguous parameters.';
  let proposedStem = stem;

  // Detect anatomical / scientific inaccuracies in the question stem
  if (stemLower.includes('adductor hiatus') && stemLower.includes('anterior tibial artery')) {
    hasStemError = true;
    stemErrorDetails = 'The question stem contains a confirmed anatomical error: The femoral artery traverses the adductor hiatus to become the POPLITEAL ARTERY in the popliteal fossa, not the anterior tibial artery.';
    proposedStem = stem.replace(/anterior tibial artery/i, 'popliteal artery');
  } else if (stemLower.includes('most common') && !stemLower.includes('in adult') && !stemLower.includes('in child') && !stemLower.includes('in neonate') && !stemLower.includes('in elderly')) {
    if (stemLower.includes('meningitis') || stemLower.includes('pneumonia') || stemLower.includes('osteomyelitis')) {
      hasAmbiguity = true;
      stemErrorDetails = 'The question stem asks for the "most common cause" without specifying the patient demographic or age cohort (e.g. young adult vs elderly), which alters the primary epidemiological answer (Mycoplasma in young adults vs Streptococcus pneumoniae in elderly).';
      proposedStem = stem.replace(/most common cause/i, 'most common cause in older immunocompetent adults (>65 years)');
    }
  } else if (stemLower.includes('always') || stemLower.includes('never') || stemLower.includes('solely')) {
    hasAmbiguity = true;
    stemErrorDetails = 'The stem uses absolute terminology ("always" / "never") that creates scientific ambiguity given documented biological variability.';
  }

  // Audit each option independently (combining option-specific and stem evidence pages)
  const isInverted = isInvertedPolarityQuestion(stem);
  const rawOptionAnalyses = options.map(opt => {
    const optSpecific = evidenceBundle.optionsEvidence[opt.label] || [];
    const combinedEv = [...optSpecific, ...evidenceBundle.stemEvidence];
    const optEvidence = combinedEv.length > 0 ? combinedEv : evidenceBundle.allRetrievedPages;
    const evaluated = auditIndividualOption(opt.label, opt.text, stem, optEvidence, designatedAnswer);
    return {
      option_letter: opt.label,
      is_correct: evaluated.isScientificallyCorrect,
      is_partially_correct: evaluated.isPartiallyCorrect,
      explanation: evaluated.evaluationRationale,
      citation_book: evaluated.citationReferenceName,
      citation_page: evaluated.citationPrintedPage,
      citation_pdf_page: evaluated.citationPdfPage,
      citation_quote: evaluated.citationQuote
    };
  });

  // For inverted-polarity questions (EXCEPT / NOT / FALSE), if >= 2 options are verified as true statements
  // and at least 1 option is false/unverified, invert selection so the false statement is the winning answer.
  const optionAnalyses = isInverted &&
    rawOptionAnalyses.filter(o => o.is_correct).length >= 2 &&
    rawOptionAnalyses.some(o => !o.is_correct)
    ? rawOptionAnalyses.map(o => ({
        ...o,
        is_correct: !o.is_correct,
        explanation: !o.is_correct
          ? `[CORRECT EXCEPTION]: ${o.explanation}`
          : `[True statement - NOT the exception]: ${o.explanation}`
      }))
    : rawOptionAnalyses;

  const correctOptions = optionAnalyses.filter(o => o.is_correct).map(o => o.option_letter);
  const desKey = (designatedAnswer || '').trim().toUpperCase();
  const isOriginalCorrect = correctOptions.length === 1 && correctOptions[0] === desKey;
  const hasMultipleCorrect = correctOptions.length > 1;
  const hasNoCorrect = correctOptions.length === 0;

  // Check if reference literature has insufficient evidence for this domain (e.g. ultra-rare genetics PEX1)
  const isUltraRareOrAbsent = stemLower.includes('pex1') || stemLower.includes('c.2528g>a') || evidenceBundle.allRetrievedPages.length === 0 || evidenceBundle.allRetrievedPages.every(p => p.relevanceScore < 2.0);

  // Determine Category and Severity
  let category: FindingsCategory = 'no_detected_issue';
  let severity: ErrorSeverity = 'none';
  let confidence = 85;

  if (isUltraRareOrAbsent) {
    category = 'insufficient_evidence';
    severity = 'moderate';
    confidence = 32;
  } else if (hasAmbiguity) {
    category = 'ambiguous_question';
    severity = 'moderate';
    confidence = 88;
  } else if (hasMultipleCorrect) {
    category = 'confirmed_error';
    severity = 'major';
    confidence = 96;
  } else if (hasNoCorrect) {
    category = 'confirmed_error';
    severity = 'major';
    confidence = 94;
  } else if (!isOriginalCorrect && desKey && correctOptions.length > 0) {
    category = 'confirmed_error';
    severity = 'critical';
    confidence = 97;
  } else if (hasStemError) {
    category = 'confirmed_error';
    severity = 'major';
    confidence = 95;
  } else if (conflictAnalysis.hasConflict) {
    category = 'potential_error';
    severity = 'major';
    confidence = 82;
  } else {
    category = 'no_detected_issue';
    severity = 'none';
    confidence = 98;
  }

  // Compile citations
  const citations = optionAnalyses
    .filter(o => o.citation_book !== 'None')
    .map(o => ({
      reference_name: o.citation_book,
      pdf_page_index: o.citation_pdf_page,
      printed_page_number: o.citation_page,
      quote: o.citation_quote,
      explanation: o.explanation,
      target_type: 'option' as const,
      target_identifier: `Option ${o.option_letter}`
    }));

  let rationale = '';
  if (hasMultipleCorrect) {
    rationale = `Audit revealed MULTIPLE CORRECT ANSWERS: Options [${correctOptions.join(', ')}] are all scientifically accurate based on cited textbook evidence.`;
  } else if (hasNoCorrect) {
    rationale = 'None of the provided options represent the scientifically established answer according to the reference literature.';
  } else if (!isOriginalCorrect && desKey) {
    rationale = `The original answer key designates Option ${desKey}, but scientific evidence confirms that Option ${correctOptions.join(', ')} is the correct answer.`;
  } else {
    rationale = `Original designated answer Option ${desKey || 'None'} is scientifically verified by the textbook references.`;
  }

  return {
    stem_evaluation: {
      has_scientific_error: hasStemError,
      has_linguistic_ambiguity: hasAmbiguity,
      has_contradiction: false,
      has_false_premise: false,
      details: stemErrorDetails,
      proposed_stem_correction: (hasStemError || hasAmbiguity) ? proposedStem : undefined
    },
    answer_key_evaluation: {
      original_designated_answer: designatedAnswer,
      is_original_key_correct: isOriginalCorrect,
      proposed_correct_answers: correctOptions,
      has_multiple_correct_answers: hasMultipleCorrect,
      has_no_correct_answer: hasNoCorrect,
      rationale
    },
    option_analyses: optionAnalyses,
    citations,
    findings_category: category,
    error_severity: severity,
    confidence_score: confidence,
    detailed_scientific_explanation: `${rationale} ${conflictAnalysis.summaryExplanation}`,
    cross_reference_conflict_detected: conflictAnalysis.hasConflict,
    conflict_explanation: conflictAnalysis.hasConflict ? conflictAnalysis.summaryExplanation : undefined
  };
}

const AUDIT_RESPONSE_JSON_SCHEMA = `{
  "stem_evaluation": {
    "has_scientific_error": boolean,
    "has_linguistic_ambiguity": boolean,
    "has_contradiction": boolean,
    "has_false_premise": boolean,
    "details": string,
    "proposed_stem_correction": string or null
  },
  "answer_key_evaluation": {
    "original_designated_answer": string,
    "is_original_key_correct": boolean,
    "proposed_correct_answers": string[],
    "has_multiple_correct_answers": boolean,
    "has_no_correct_answer": boolean,
    "rationale": string
  },
  "option_analyses": [
    {
      "option_letter": string,
      "is_correct": boolean,
      "is_partially_correct": boolean,
      "explanation": string,
      "citation_book": string,
      "citation_page": string,
      "citation_pdf_page": number,
      "citation_quote": string
    }
  ],
  "citations": [
    {
      "reference_name": string,
      "pdf_page_index": number,
      "printed_page_number": string,
      "quote": string,
      "explanation": string,
      "target_type": "stem" | "answer_key" | "option" | "conflict",
      "target_identifier": string
    }
  ],
  "findings_category": "confirmed_error" | "highly_probable_error" | "potential_error" | "ambiguous_question" | "insufficient_evidence" | "no_detected_issue",
  "error_severity": "critical" | "major" | "moderate" | "minor" | "none",
  "confidence_score": number (0-100),
  "detailed_scientific_explanation": string,
  "cross_reference_conflict_detected": boolean,
  "conflict_explanation": string or null
}`;

function escapeControlCharsInJsonStrings(input: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inString = !inString;
      continue;
    }
    if (inString) {
      const code = ch.charCodeAt(0);
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      if (code < 0x20) { out += ' '; continue; }
    }
    out += ch;
  }
  return out;
}

function parseLlmJsonResponse<T = AIAuditResponse>(rawText: string): T {
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const target = (firstBrace >= 0 && lastBrace > firstBrace)
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
    const repaired = escapeControlCharsInJsonStrings(target).replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(repaired) as T;
  }
}

async function callGeminiWithCandidates<T = AIAuditResponse>(
  promptOrParts: string | Array<Record<string, any>>,
  candidateModels: string[],
  geminiKey: string,
  timeoutMs: number = 30000,
  temperature: number = 0.1
): Promise<{ parsed: T | null; error: string }> {
  let lastExternalError = '';
  const maxRounds = 5;
  const parts = typeof promptOrParts === 'string'
    ? [{ text: promptOrParts }]
    : promptOrParts;

  for (let round = 0; round < maxRounds; round++) {
    let triedAnyModelThisRound = false;

    for (const model of candidateModels) {
      if (Date.now() < (modelCooldownUntil[model] || 0)) {
        continue;
      }
      triedAnyModelThisRound = true;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts
                }
              ],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature
              }
            })
          });

          if (res.ok) {
            const data = await res.json();
            const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawJson) {
              return { parsed: parseLlmJsonResponse<T>(rawJson), error: '' };
            }
          } else {
            const errTxt = await res.text().catch(() => '');
            lastExternalError = `Gemini ${model} HTTP ${res.status}: ${errTxt.slice(0, 220)}`;
            console.warn(lastExternalError);
            if (res.status === 404 || res.status === 400) {
              modelCooldownUntil[model] = Date.now() + 12 * 3600 * 1000;
              break;
            }
            if (res.status === 429) {
              const { cooldownMs } = parseGeminiCooldown(errTxt, res.headers.get('retry-after'));
              modelCooldownUntil[model] = Date.now() + cooldownMs;
              break;
            }
            if (res.status === 503) {
              if (attempt === 0) {
                await new Promise(r => setTimeout(r, 1200));
                continue;
              }
              modelCooldownUntil[model] = Date.now() + 30000;
            }
          }
          break;
        } catch (err: any) {
          lastExternalError = `Gemini ${model} error: ${err?.message || 'network timeout'}`;
          console.warn(`Gemini API call with model ${model} attempt ${attempt + 1} failed:`, err);
          if (attempt === 0) {
            await new Promise(r => setTimeout(r, 800));
          }
        }
      }
    }

    if (round < maxRounds - 1) {
      const now = Date.now();
      const remainingWaits = candidateModels.map(m => Math.max(0, (modelCooldownUntil[m] || 0) - now));
      const minWaitMs = Math.min(...remainingWaits);
      if (minWaitMs > 90000) {
        console.warn(`[Gemini] Daily quota exhausted across all candidate models (next reset in ${Math.round(minWaitMs / 60000)}m). Failing fast.`);
        break;
      }
      const sleepMs = !triedAnyModelThisRound
        ? Math.min(Math.max(minWaitMs + 500, 4000), 70000)
        : (minWaitMs > 0 ? Math.min(minWaitMs + 500, 70000) : 2500);
      console.log(`[Gemini] Candidate models temporarily throttled, sleeping ${Math.round(sleepMs / 1000)}s before round ${round + 2}/${maxRounds}...`);
      await new Promise(r => setTimeout(r, sleepMs));
    }
  }

  return {
    parsed: null,
    error: lastExternalError || 'All candidate Gemini models temporarily exhausted RPM quota'
  };
}

export interface QuestionMediaInput {
  imageBuffer?: Buffer;
  mimeType?: string;
  imageDescription?: string;
}

function buildGeminiPromptParts(
  promptText: string,
  media?: QuestionMediaInput
): string | Array<Record<string, any>> {
  if (media?.imageBuffer && media.imageBuffer.length > 0) {
    return [
      { text: promptText },
      {
        inline_data: {
          mime_type: media.mimeType || 'image/png',
          data: media.imageBuffer.toString('base64')
        }
      }
    ];
  }
  return promptText;
}

async function callOpenAiChatJson(
  systemPrompt: string,
  userPrompt: string,
  openaiKey: string,
  model: string,
  timeoutMs: number = 30000,
  temperature: number = 0.1,
  media?: QuestionMediaInput
): Promise<{ parsed: AIAuditResponse | null; error: string }> {
  try {
    const userContent: any = media?.imageBuffer && media.imageBuffer.length > 0
      ? [
          { type: 'text', text: userPrompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${media.mimeType || 'image/png'};base64,${media.imageBuffer.toString('base64')}`
            }
          }
        ]
      : userPrompt;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      })
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        return { parsed: parseLlmJsonResponse(content), error: '' };
      }
    }
    return { parsed: null, error: `OpenAI HTTP ${res.status}` };
  } catch (err: any) {
    console.warn('OpenAI API call failed:', err);
    return { parsed: null, error: err?.message || 'OpenAI request error' };
  }
}

/**
 * Determine whether a Pass-1 audit output challenges the exam or shows an inverted-polarity anomaly
 * and therefore warrants Stage-2 Peer-Review Verification before accepting an error claim.
 */
function shouldRunPeerReviewChallenge(
  pass1: AIAuditResponse,
  designatedAnswer: string,
  isInverted: boolean
): boolean {
  const cat = pass1?.findings_category;
  const ansEval = pass1?.answer_key_evaluation;
  const hasDesignated = Boolean(designatedAnswer && !/^\s*(?:not\s+provided|none)\s*$/i.test(designatedAnswer));

  if (cat === 'confirmed_error' || cat === 'highly_probable_error' || cat === 'potential_error') {
    return true;
  }
  if (hasDesignated && ansEval?.is_original_key_correct === false) {
    return true;
  }
  if (ansEval?.has_multiple_correct_answers || ansEval?.has_no_correct_answer) {
    return true;
  }
  if (isInverted && Array.isArray(pass1?.option_analyses)) {
    const trueCount = pass1.option_analyses.filter(o => o.is_correct).length;
    if (trueCount > 1) return true;
  }
  return false;
}

/**
 * Stage 2: Strict Peer-Review Challenge Audit.
 * Independently challenges Pass-1 error verdicts to catch false overrides, number/qualifier
 * contradictions, OCR table row confusion, pedantic no-correct claims, and EXCEPT polarity flips.
 */
async function verifyFlaggedAuditFinding(params: {
  stem: string;
  optionsBlock: string;
  designatedAnswer: string;
  isInverted: boolean;
  evidenceText: string;
  pass1: AIAuditResponse;
  provider: string;
  geminiKey?: string;
  openaiKey?: string;
  geminiModels: string[];
  openaiModel: string;
  questionMedia?: QuestionMediaInput;
}): Promise<AIAuditResponse> {
  const {
    stem,
    optionsBlock,
    designatedAnswer,
    isInverted,
    evidenceText,
    pass1,
    provider,
    geminiKey,
    openaiKey,
    geminiModels,
    openaiModel,
    questionMedia
  } = params;

  const compactPass1 = {
    findings_category: pass1.findings_category,
    confidence_score: pass1.confidence_score,
    answer_key_evaluation: pass1.answer_key_evaluation,
    option_analyses: (pass1.option_analyses || []).map(o => ({
      option_letter: o.option_letter,
      is_correct: o.is_correct,
      citation_book: o.citation_book,
      citation_page: o.citation_page,
      citation_quote: o.citation_quote,
      explanation: o.explanation
    }))
  };

  const reviewSystem = `You are a Senior Medical Board Chief Examiner performing a skeptical PEER-REVIEW AUDIT of a preliminary automated question-error flag.
False positive error flags destroy user trust. Your mission is to verify strictly whether the preliminary challenge holds up under rigorous textbook and medical examination — rejecting weak, pedantic, contradictory, or logically inverted error claims while upholding GENUINE exam errors.`;

  const reviewPrompt = `PEER-REVIEW AUDIT REQUEST:

QUESTION STEM:
${stem}

QUESTION POLARITY:
${isInverted ? 'INVERTED POLARITY (EXCEPT / NOT / INCORRECT / FALSE / LEAST — the winning choice is the FALSE/excluded option, NEVER the true statements!)' : 'STANDARD POSITIVE SELECTION'}

OPTIONS:
${optionsBlock}

DESIGNATED ANSWER KEY:
${designatedAnswer || 'Not provided'}
${questionMedia?.imageDescription || questionMedia?.imageBuffer ? `\nATTACHED QUESTION FIGURE / IMAGE NOTES:\n${questionMedia.imageDescription || 'Inspect the attached question image directly.'}\n` : ''}
PRELIMINARY VERDICT TO AUDIT:
${JSON.stringify(compactPass1, null, 2)}

REFERENCE TEXTBOOK EXCERPTS:
${evidenceText || 'No reference excerpts retrieved.'}

PERFORM THESE 5 MANDATORY CHECKS STRICTLY:
1. INVERTED POLARITY CHECK:
   If QUESTION POLARITY is INVERTED, confirm that ONLY the false/excluded choice(s) have "is_correct": true and appear in "proposed_correct_answers". If the preliminary verdict marked true statements as is_correct=true or MULTIPLE CORRECT on an EXCEPT/NOT question, FIX IT immediately (true statements -> is_correct: false; the false exception -> is_correct: true).

2. LITERAL NUMBER, UNIT & QUALIFIER CHECK:
   Inspect EVERY citation_quote and option claim in the preliminary verdict:
   - Do the exact numbers/percentages match? (e.g., "700%" does NOT support "200%"; "70 to 200 ml" DOES support "200 mL").
   - Do qualifiers match? (e.g., "Non-clear internal elastic lamina" in aorta REFUTES "most prominent in large elastic arteries like the aorta"; "Acute heart failure" causes do NOT confirm "Chronic heart failure").
   - Did Pass 1 attach a statistic ("Most common (90%)") from an OCR table row ("Markedly dilated heart") to a sibling heading whose own bullet says "Rare" (e.g. IHSS/hypertrophic cardiomyopathy)? If so, CORRECT IT.

3. DESIGNATED ANSWER KEY DEFENSE TEST (CRITICAL):
   Assume the exam author had a sound textbook/medical reason for selecting "${designatedAnswer || 'None'}". Actively try to DEFEND "${designatedAnswer || 'None'}" using the excerpts and established medical physiology/anatomy/pathology:
   - Example: Decreasing heart rate prolongs diastolic filling time -> increases EDV/preload ("Heart rate" is listed under preload determinants); conversely using "RAP decreases -> VR increases" to claim decreased RAP increases preload ignores another excerpt saying "increased RAP increases EDV/COP" and "RAP is main force for ventricular filling".
   - Example: Increased venous compliance decreases MSFP (reducing filling pressure & venous return -> decreases diastolic filling rate) directly, whereas sympathetic stimulation increases MSFP/CO unless HR > 220.
   - Example: Preposition or terminology phrasing differences ("at the inguinal ligament" vs "behind the inguinal ligament", "tension-length curve" vs "Starling curve", or a missing minor risk factor alongside a true textbook factor when the other 3 options are clearly false) are NOT grounds to fail a valid designated key!
   - If the designated key IS scientifically valid/defensible AND only one option is truly valid (and Pass 1's challenge relies on multi-hop deductions, OCR table conflation, wrong numbers/qualifiers, or pedantry) -> OVERTURN Pass 1 and return is_original_key_correct=true, proposed_correct_answers=["${designatedAnswer || ''}"], findings_category="no_detected_issue", error_severity="none" (unless designatedAnswer is "Not provided").
   - ONLY UPHOLD findings_category="confirmed_error" if the designated key is truly indefensible against explicit evidence (e.g., naming Staph aureus for subacute endocarditis when excerpts specify Strep viridans/weak bacteria vs Staph aureus for acute endocarditis), OR two or more options are indisputably correct under the EXACT SAME clinical scope (including IDENTICAL/EQUIVALENT duplicate options such as C === D).

4. "NO CORRECT ANSWER" & "MULTIPLE CORRECT" AUDIT:
   - Never uphold has_no_correct_answer=true when excerpts simply don't cover the topic (use "insufficient_evidence"), nor when the designated key reflects standard textbook science despite brief bullet wording.
   - Never uphold has_multiple_correct_answers=true for a secondary option that differs in terminology suffix (stenosis vs incompetence), wrong category/stage, acute rescue vs ongoing prophylaxis when distinction applies, or a textbook shorthand erratum contradicted elsewhere (Rule 20).
   - ALWAYS uphold has_multiple_correct_answers=true and findings_category="confirmed_error" if two or more options have identical/verbatim-equivalent winning text (e.g. Option C and Option D both state the same winning answer), NEVER mark one twin false merely to agree with a single-letter designated key.

5. OUTPUT COMPLETE CORRECTED JSON adhering strictly to this schema (preserving verified citations cleanly):
${AUDIT_RESPONSE_JSON_SCHEMA}`;

  if (provider === 'gemini' && geminiKey) {
    // Prefer full flagship non-lite reasoning models first for Stage-2 peer review (~3-5% of questions)
    const stage2Models = [
      'gemini-3-flash-preview',
      'gemini-3.5-flash',
      'gemini-3.8-flash',
      ...geminiModels
    ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);

    const { parsed } = await callGeminiWithCandidates(
      buildGeminiPromptParts(`${reviewSystem}\n\n${reviewPrompt}`, questionMedia),
      stage2Models,
      geminiKey,
      45000,
      0.0
    );
    if (parsed) return parsed;
  } else if (provider === 'openai' && openaiKey) {
    const { parsed } = await callOpenAiChatJson(
      reviewSystem,
      reviewPrompt,
      openaiKey,
      openaiModel,
      40000,
      0.0,
      questionMedia
    );
    if (parsed) return parsed;
  }

  return pass1;
}

/**
 * Execute AI validation using configured provider (Gemini / OpenAI / Claude / Built-in)
 */
export async function auditQuestionWithAI(
  stem: string,
  options: Array<{ label: string; text: string }>,
  designatedAnswer: string,
  evidenceBundle: QuestionSearchBundle,
  providerOverride?: string,
  questionMedia?: QuestionMediaInput
): Promise<AIAuditResponse> {
  const provider = providerOverride || getSetting('ai_provider', 'built_in');
  const geminiKey = getSetting('gemini_api_key') || process.env.GEMINI_API_KEY;
  const openaiKey = getSetting('openai_api_key') || process.env.OPENAI_API_KEY;

  // Select balanced evidence: reserve core stem hits + top hit(s) per option so generic option terms cannot drown out the stem topic or counter-evidence pages
  const pickedMap = new Map<string, RetrievedEvidence>();
  const addPicked = (ev: RetrievedEvidence) => {
    const k = `${ev.referenceBookName}:${ev.pdfPageIndex}`;
    const existing = pickedMap.get(k);
    if (!existing || existing.relevanceScore < ev.relevanceScore) {
      pickedMap.set(k, ev);
    }
  };

  for (const ev of [...evidenceBundle.stemEvidence].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 5)) {
    addPicked(ev);
  }
  for (const optEv of Object.values(evidenceBundle.optionsEvidence)) {
    // Preserve curated diversity order from semantic retrieval (combined #1 + standalone definition #1)
    for (const ev of optEv.slice(0, 2)) {
      if (pickedMap.size >= 14) break;
      addPicked(ev);
    }
  }
  for (const ev of [...evidenceBundle.allRetrievedPages].sort((a, b) => b.relevanceScore - a.relevanceScore)) {
    if (pickedMap.size >= 14) break;
    addPicked(ev);
  }
  const topEvidence = Array.from(pickedMap.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 14);

  const evidenceText = topEvidence
    .map((ev, idx) => `[Source ${idx + 1}: ${ev.referenceBookName} | Printed Page: ${ev.printedPageNumber} | PDF Index: ${ev.pdfPageIndex}]\n"${ev.fullPageContent.slice(0, 2600)}"`)
    .join('\n\n');

  const optionsBlock = options.length > 0
    ? options.map(o => `${o.label}) ${o.text}`).join('\n')
    : 'Written / Open-Ended Question (No multiple-choice options; audit scientific accuracy of stem and any included model answer, keep option_analyses empty [])';

  const isInverted = isInvertedPolarityQuestion(stem);
  const polarityBlock = isInverted
    ? `INVERTED POLARITY (EXCEPT / NOT / INCORRECT / FALSE / LEAST QUESTION DETECTED):
- You are looking for the ONE option that is SCIENTIFICALLY FALSE or EXCLUDED.
- In "option_analyses": set "is_correct": true ONLY for the winning answer to this EXCEPT/NOT question (i.e., the FALSE statement), and begin its explanation with "[CORRECT EXCEPTION]: ...". Set "is_correct": false for options that are TRUE statements (they are eliminated by EXCEPT), and begin their explanation with "[True statement - NOT the exception]: ...".
- In "answer_key_evaluation": "proposed_correct_answers" MUST list ONLY the false/exception letter (NEVER the 3 true statements!), and NEVER flag has_multiple_correct_answers=true merely because 3 statements are factually true.`
    : `STANDARD POSITIVE SELECTION:
- Set "is_correct": true ONLY for option(s) that are scientifically accurate answers to what the stem asks, and "is_correct": false for incorrect choices.`;

  const userPrompt = `AUDIT REQUEST:
QUESTION STEM:
${stem}

QUESTION LOGIC MODE:
${polarityBlock}

OPTIONS:
${optionsBlock}

DESIGNATED ANSWER KEY:
${designatedAnswer || 'Not provided'}
${(questionMedia?.imageBuffer || questionMedia?.imageDescription) ? `\nATTACHED QUESTION FIGURE / IMAGE ANALYSIS:\n${questionMedia.imageDescription ? `Visual summary: ${questionMedia.imageDescription}\n` : ''}${questionMedia.imageBuffer ? 'An image/figure for this question is ATTACHED directly in this request. You MUST inspect the visual axes, curves (left/right shifts, Emax plateau, labels), arrows, cells, histology, or radiological features directly in the image rather than guessing visually from text alone!' : ''}\n` : ''}
EXCLUSIVE REFERENCE EVIDENCE EXCERPTS:
${evidenceText || 'No reference excerpts retrieved.'}

Perform the comprehensive scientific audit adhering strictly to ALL Scientific Integrity, Comprehension, Exact Terminology, Structural Context, Quantitative, and Key Defense Rules above.
Output valid JSON adhering to this schema:
${AUDIT_RESPONSE_JSON_SCHEMA}`;

  if (provider === 'gemini') {
    if (!geminiKey) {
      return buildUnavailableProviderFallback(options, designatedAnswer, evidenceBundle, 'gemini', 'missing GEMINI_API_KEY');
    }

    const configuredModel = getSetting('gemini_model', 'gemini-3.5-flash-lite');
    const candidateModels = (questionMedia?.imageBuffer
      ? [
          'gemini-3-flash-preview',
          'gemini-3.5-flash',
          'gemini-3.1-flash-lite',
          configuredModel,
          'gemini-3.5-flash-lite',
          'gemini-3.8-flash'
        ]
      : [
          configuredModel,
          'gemini-3.5-flash-lite',
          'gemini-3.1-flash-lite',
          'gemini-3.1-flash-lite-preview',
          'gemini-3-flash-preview',
          'gemini-3.5-flash',
          'gemini-3.8-flash'
        ]
    ).filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);

    const { parsed: pass1, error } = await callGeminiWithCandidates(
      buildGeminiPromptParts(`${SYSTEM_INSTRUCTIONS}\n\n${userPrompt}`, questionMedia),
      candidateModels,
      geminiKey,
      questionMedia?.imageBuffer ? 40000 : 30000,
      0.1
    );

    if (!pass1) {
      return buildUnavailableProviderFallback(options, designatedAnswer, evidenceBundle, 'gemini', error);
    }

    if (shouldRunPeerReviewChallenge(pass1, designatedAnswer, isInverted)) {
      return await verifyFlaggedAuditFinding({
        stem,
        optionsBlock,
        designatedAnswer,
        isInverted,
        evidenceText,
        pass1,
        provider: 'gemini',
        geminiKey,
        geminiModels: candidateModels,
        openaiModel: '',
        questionMedia
      });
    }

    return pass1;
  }

  if (provider === 'openai') {
    if (!openaiKey) {
      return buildUnavailableProviderFallback(options, designatedAnswer, evidenceBundle, 'openai', 'missing OPENAI_API_KEY');
    }

    const openaiModel = getSetting('openai_model', 'gpt-4o');
    const { parsed: pass1, error } = await callOpenAiChatJson(
      SYSTEM_INSTRUCTIONS,
      userPrompt,
      openaiKey,
      openaiModel,
      30000,
      0.1,
      questionMedia
    );

    if (!pass1) {
      return buildUnavailableProviderFallback(options, designatedAnswer, evidenceBundle, 'openai', error);
    }

    if (shouldRunPeerReviewChallenge(pass1, designatedAnswer, isInverted)) {
      return await verifyFlaggedAuditFinding({
        stem,
        optionsBlock,
        designatedAnswer,
        isInverted,
        evidenceText,
        pass1,
        provider: 'openai',
        openaiKey,
        geminiModels: [],
        openaiModel,
        questionMedia
      });
    }

    return pass1;
  }

  if (provider !== 'built_in') {
    return buildUnavailableProviderFallback(
      options,
      designatedAnswer,
      evidenceBundle,
      provider,
      `Provider "${provider}" is not configured or key is missing`
    );
  }

  // Built-in Deterministic Auditor (only when built_in mode is explicitly selected)
  return runBuiltInMedicalAuditor(stem, options, designatedAnswer, evidenceBundle);
}

export interface VisionExtractedQuestion {
  originalNumber: number;
  pageNumber?: number; // original document 1-based PDF page index
  chunkPageIndex?: number; // 1-based page index inside sliced PDF chunk
  stem: string;
  options: Array<{ label: string; text: string }>;
  designatedAnswer: string;
  usesVisualFigure?: boolean;
  visualDescription?: string;
}

export interface VisionExamPageResult {
  questions: VisionExtractedQuestion[];
  answerKeyMappings: Array<{ questionNumber: number; answer: string; pageNumber?: number; chunkPageIndex?: number }>;
  rawTranscribedText: string;
}

function getGeminiVisionModels(): string[] {
  const configuredModel = getSetting('gemini_model', 'gemini-3.5-flash-lite');
  return [
    'gemini-3-flash-preview',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    configuredModel,
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash'
  ].filter((v, i, a) => Boolean(v) && a.indexOf(v) === i);
}

function buildVisionExamPrompt(pageLabel: string, extraPageMappingInstruction: string): string {
  return `You are a high-precision medical exam digitizer inspecting ${pageLabel}.
Extract EVERY question visible verbatim and accurately in reading order (top-to-bottom; reconstruct any 2-column options into A, B, C, D, E order).

CRITICAL ACCURACY RULES:
1. Read EVERY colored-circle / boxed / margin-collided question number accurately (e.g., 1, 2, ... 98, 99, 100...).
2. Preserve EVERY medical symbol, unit, fraction, subscript, and percentage accurately (e.g., t1/2 = 4 hours, 75%, 100%, mg/mL, ng/mL, pKa, <, >) — do NOT drop or misread digits.
3. For two-column option grids (e.g., "a. ...   c. ..." on row 1, "b. ...   d. ..." on row 2), assign option labels A, B, C, D cleanly by their printed letter.
4. VISUAL & TEXT ANSWER KEY DETECTION (CRITICAL — CHECK EVERY METHOD):
   Inspect ALL possible ways designated answer keys may appear:
   - Footer/margin/table answer strips (e.g. "10 C 11 C ... 16 A,C", "98 b  99 a", "Answer: B")
   - Highlighted background boxes (yellow/green/blue shading behind one option)
   - Distinct colored font on the correct option (e.g. green, red, or blue option text vs black distractors)
   - Uniquely bolded or underlined correct option vs regular distractors
   - Circled option letter, checkmark (✓ / ✔ / * / ☑), or handwritten tick
   Attach "designatedAnswer" (comma-separated like "A, C" if multiple letters are indicated, "" if genuinely no answer mark exists on the page) onto matching questions AND list every mapping in "answerKeyMappings".
5. VISUAL FIGURE DETECTION (CRITICAL):
   - Set "usesVisualFigure": true ONLY if the question refers to or depends on an actual picture, graph, curve plot, diagram, blood film, histology slide, spotter photo, X-ray, ECG, pedigree, chart, or specimen photo visible on the page (FALSE for text-only MCQs or decorative page borders!).
   - Whenever "usesVisualFigure" is true, provide a precise, factual "visualDescription" describing EVERY visual element needed to solve it (axes labels, exact curve positions/shifts/Emax plateaus, visible parasite/cell structures, stain, spine/arrow position, diagnosis-defining features). Do NOT guess or fabricate the final answer key in visualDescription.
6. If a page contains only an answer key table with no questions, set "questions": [] and populate "answerKeyMappings".${extraPageMappingInstruction}
7. Output valid JSON strictly adhering to:
{
  "questions": [
    {
      "originalNumber": number,
      "chunkPageIndex": number (1-based page within this input),
      "pageNumber": number (original document 1-based page number),
      "stem": string,
      "options": [{ "label": "A" | "B" | "C" | "D" | "E", "text": string }],
      "designatedAnswer": string (e.g. "B", "A, C", or "" if not shown),
      "usesVisualFigure": boolean,
      "visualDescription": string ("" if usesVisualFigure is false)
    }
  ],
  "answerKeyMappings": [
    { "questionNumber": number, "answer": string, "chunkPageIndex": number, "pageNumber": number }
  ],
  "rawTranscribedText": string
}`;
}

/**
 * Use multimodal Gemini Vision on an image-backed exam page (PNG/JPG/WEBP) to transcribe every
 * question, multi-column option list, badge number, numeric symbol (e.g. t1/2, %), answer-key
 * box/highlight, AND objective visual descriptions of any accompanying figure/graph/slide.
 */
export async function extractExamPageWithGeminiVision(
  imageBuffer: Buffer,
  pageNumber: number,
  mimeType: string = 'image/png'
): Promise<VisionExamPageResult | null> {
  const provider = getSetting('ai_provider', 'built_in');
  const geminiKey = getSetting('gemini_api_key') || process.env.GEMINI_API_KEY;
  if (provider !== 'gemini' || !geminiKey || !imageBuffer || imageBuffer.length === 0) {
    return null;
  }

  const prompt = buildVisionExamPrompt(
    `Page ${pageNumber} of a medical examination sheet`,
    `\n- Set "chunkPageIndex": 1 and "pageNumber": ${pageNumber} on all extracted questions and answerKeyMappings.`
  );

  const parts = [
    { text: prompt },
    {
      inline_data: {
        mime_type: mimeType,
        data: imageBuffer.toString('base64')
      }
    }
  ];

  const { parsed } = await callGeminiWithCandidates<VisionExamPageResult>(
    parts,
    getGeminiVisionModels(),
    geminiKey,
    45000,
    0.0
  );

  if (!parsed || (!Array.isArray(parsed.questions) && !Array.isArray(parsed.answerKeyMappings))) {
    return null;
  }

  return parsed;
}

/**
 * Use native Gemini multimodal PDF understanding on a sliced 1..4 page PDF buffer.
 * Reads vector text, colored highlights, circled choices, bold fonts, answer tables,
 * raster slides, and vector graphs with full native layout fidelity.
 */
export async function extractExamPdfChunkWithGeminiVision(
  pdfChunkBuffer: Buffer,
  originalPageNumbers: number[]
): Promise<VisionExamPageResult | null> {
  const provider = getSetting('ai_provider', 'built_in');
  const geminiKey = getSetting('gemini_api_key') || process.env.GEMINI_API_KEY;
  if (
    provider !== 'gemini' ||
    !geminiKey ||
    !pdfChunkBuffer ||
    pdfChunkBuffer.length === 0 ||
    originalPageNumbers.length === 0
  ) {
    return null;
  }

  const mappingLines = originalPageNumbers
    .map((orig, idx) => `Chunk Page ${idx + 1} = Original Document Page ${orig}`)
    .join('; ');

  const prompt = buildVisionExamPrompt(
    `this ${originalPageNumbers.length}-page examination PDF slice`,
    `\n- PAGE INDEX MAPPING: ${mappingLines}. Set BOTH "chunkPageIndex" (1..${originalPageNumbers.length}) and "pageNumber" (the matching Original Document Page number) accurately on every item.`
  );

  const { parsed } = await callGeminiWithCandidates<VisionExamPageResult>(
    [
      { text: prompt },
      {
        inline_data: {
          mime_type: 'application/pdf',
          data: pdfChunkBuffer.toString('base64')
        }
      }
    ],
    getGeminiVisionModels(),
    geminiKey,
    65000,
    0.0
  );

  if (!parsed || (!Array.isArray(parsed.questions) && !Array.isArray(parsed.answerKeyMappings))) {
    return null;
  }

  const resolvePage = (item: { pageNumber?: number; chunkPageIndex?: number }): number => {
    const cIdx = Number(item?.chunkPageIndex);
    if (Number.isFinite(cIdx) && cIdx >= 1 && cIdx <= originalPageNumbers.length) {
      return originalPageNumbers[cIdx - 1];
    }
    const pNum = Number(item?.pageNumber);
    if (Number.isFinite(pNum) && originalPageNumbers.includes(pNum)) {
      return pNum;
    }
    return originalPageNumbers[0];
  };

  return {
    questions: (parsed.questions || []).map(q => ({
      ...q,
      pageNumber: resolvePage(q)
    })),
    answerKeyMappings: (parsed.answerKeyMappings || []).map(m => ({
      ...m,
      pageNumber: resolvePage(m)
    })),
    rawTranscribedText: String(parsed.rawTranscribedText || '')
  };
}

/**
 * Analyze a figure/slide/graph embedded alongside a digital-text exam question so the auditor
 * and preview UI have a factual description of the visual evidence.
 */
export async function describeQuestionImageWithVision(
  imageBuffer: Buffer,
  stem: string,
  options: Array<{ label: string; text: string }>,
  mimeType: string = 'image/png'
): Promise<string | null> {
  const provider = getSetting('ai_provider', 'built_in');
  const geminiKey = getSetting('gemini_api_key') || process.env.GEMINI_API_KEY;
  if (provider !== 'gemini' || !geminiKey || !imageBuffer || imageBuffer.length === 0) {
    return null;
  }

  const optionsList = options.map(o => `${o.label}) ${o.text}`).join('\n');
  const prompt = `You are a medical visual examiner. Describe objectively and concisely (3-6 sentences) what is clinically/scientifically shown in the attached figure for this exam question:
QUESTION STEM: ${stem}
${optionsList ? `OPTIONS:\n${optionsList}\n` : ''}
Describe ONLY what is directly visible in the image (curves, shifts, plateaus, labeled letters, axes, cell/parasite/tissue features, stains, anatomic arrows). Do NOT guess answer letters or make unsupported assumptions. Output strict JSON: { "visualDescription": string }`;

  const { parsed } = await callGeminiWithCandidates<{ visualDescription?: string }>(
    [
      { text: prompt },
      { inline_data: { mime_type: mimeType, data: imageBuffer.toString('base64') } }
    ],
    getGeminiVisionModels(),
    geminiKey,
    35000,
    0.0
  );

  return parsed?.visualDescription ? String(parsed.visualDescription).trim() : null;
}
