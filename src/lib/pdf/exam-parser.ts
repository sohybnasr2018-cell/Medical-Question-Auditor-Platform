/**
 * Medical Examination Questions Parser
 * Extracts individual stems, choices (a/b/c/d/e or A/B/C/D/E, single- or two-column),
 * written/essay questions, and designated answer keys (inline or from end-of-book answer matrices).
 */

export function detectMedicalDiscipline(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('histo')) return 'Histology';
  if (t.includes('embryo')) return 'Embryology';
  if (t.includes('pharma') || t.includes('drug') || t.includes('antibiotic')) return 'Pharmacology';
  if (t.includes('para') || t.includes('parasit') || t.includes('malaria') || t.includes('helminth')) return 'Parasitology';
  if (t.includes('path') || t.includes('necrosis') || t.includes('biopsy')) return 'Pathology';
  if (t.includes('bio') || t.includes('enzyme') || t.includes('metabol') || t.includes('glucose')) return 'Biochemistry';
  if (t.includes('anat') || t.includes('artery') || t.includes('nerve') || t.includes('muscle')) return 'Anatomy';
  if (t.includes('physio') || t.includes('action potential') || t.includes('clearance')) return 'Physiology';
  if (t.includes('micro') || t.includes('bacteria') || t.includes('virus')) return 'Microbiology';
  if (t.includes('immuno') || t.includes('antibody') || t.includes('t-cell')) return 'Immunology';
  if (t.includes('hema') || t.includes('haem') || t.includes('anemia') || t.includes('platelet')) return 'Hematology';
  if (t.includes('ped') || t.includes('child') || t.includes('infant')) return 'Pediatrics';
  if (t.includes('surg') || t.includes('operat')) return 'Surgery';
  if (t.includes('ob') || t.includes('gyn') || t.includes('pregnan')) return 'Obstetrics & Gynecology';
  if (t.includes('cardio') || t.includes('heart') || t.includes('cvs') || t.includes('ecg')) return 'Cardiology';
  return 'General Medical Sciences';
}

function normalizeSectionKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\d+[\.\)\-\s]+/, '')
    .replace(/\bexam\s*\d+\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Parse end-of-book "Answers / Answer Key" matrix sections (e.g. "1. End Module 2022" -> { 1: 'A', 2: 'C', ... })
 * and return both the key map and the body text with the answer appendix removed.
 */
function splitAndParseAnswerKeys(rawText: string): {
  bodyText: string;
  sectionAnswers: Map<string, Record<number, string>>;
  orderedSections: Array<{ key: string; answers: Record<number, string> }>;
} {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const ansHeadingMatch = normalized.match(/(?:^|\n)\s*(?:Answers?|Answer\s+Keys?)\s*\n/i);

  if (!ansHeadingMatch || ansHeadingMatch.index === undefined) {
    return { bodyText: normalized, sectionAnswers: new Map(), orderedSections: [] };
  }

  // Only treat as an appendix if it appears in the latter half of the document and contains grid rows
  const splitPos = ansHeadingMatch.index;
  const candidateAppendix = normalized.slice(splitPos + ansHeadingMatch[0].length);
  const hasAnswerGrid = /\b1\s+2\s+3\b/.test(candidateAppendix) && /(?:^|\n)\s*[a-eA-E](?:\s+[a-eA-E]){2,}/.test(candidateAppendix);

  if (!hasAnswerGrid) {
    return { bodyText: normalized, sectionAnswers: new Map(), orderedSections: [] };
  }

  const bodyText = normalized.slice(0, splitPos);
  const lines = candidateAppendix.split('\n').map(l => l.trim()).filter(Boolean);

  const sectionAnswers = new Map<string, Record<number, string>>();
  const orderedSections: Array<{ key: string; answers: Record<number, string> }> = [];

  let currentKey = 'default';
  let currentMap: Record<number, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip running page headers inside answer pages
    if (/^(?:Pre-clinical|Question Bank|Your Daily Dose|Exam Models|Integrated Question Bank|Section|\d+\s+Exam Models|\d+\s*(?:nd|rd|st|th)?\s*Medical Year)/i.test(line)) {
      continue;
    }

    // Section heading inside Answers e.g. "1. End Module 2022" or "Final 2025"
    if (/^(?:\d+\.\s*)?(?:End\s+Module|Final|Midterm|Exam|Quiz|Model)\b/i.test(line)) {
      if (Object.keys(currentMap).length > 0) {
        sectionAnswers.set(currentKey, currentMap);
        orderedSections.push({ key: currentKey, answers: currentMap });
      }
      currentKey = normalizeSectionKey(line) || `section_${orderedSections.length + 1}`;
      currentMap = {};
      continue;
    }

    // Check paired row: numbers row followed by answer letters row
    if (/^\d+(?:\s+\d+){2,}$/.test(line) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (/^[a-eA-E](?:\s+[a-eA-E]){2,}$/.test(nextLine)) {
        const nums = line.split(/\s+/).map(n => parseInt(n, 10));
        const letters = nextLine.split(/\s+/).map(c => c.toUpperCase());
        if (nums.length === letters.length) {
          for (let k = 0; k < nums.length; k++) {
            currentMap[nums[k]] = letters[k];
          }
          i++; // skip consumed letters row
        }
      }
    }
  }

  if (Object.keys(currentMap).length > 0) {
    sectionAnswers.set(currentKey, currentMap);
    orderedSections.push({ key: currentKey, answers: currentMap });
  }

  return { bodyText, sectionAnswers, orderedSections };
}

function cleanPageNoise(text: string): string {
  return text
    .replace(/\.{4,}/g, ' ____ ')
    .replace(/^\s*Question\s+[IVXLC]+\s*[:\-].*$/gim, '')
    .replace(/^\s*(?:Section|Exam Models|Integrated Question Bank|Questions?\s*Bank|Pre-clinical|MCQs)\s*$/gim, '')
    .replace(/^\s*\d+\s+Exam Models.*$/gim, '')
    .replace(/^\s*Your Daily Dose Of Progress.*$/gim, '')
    .replace(/^\s*\d+\s*(?:st|nd|rd|th)?\s*Medical Year.*$/gim, '')
    .replace(/^\s*\d{2,4}\s*$/gm, '')
    .trim();
}

export function extractExamQuestionsFromText(rawText: string): Array<{
  questionNumber: number;
  originalNumber: number;
  stem: string;
  options: Array<{ label: string; text: string }>;
  designatedAnswer: string;
}> {
  const { bodyText, sectionAnswers, orderedSections } = splitAndParseAnswerKeys(rawText);

  // Clean page chrome lines while keeping Exam / Written / MCQs boundary markers intact for answer lookup
  const lines = bodyText.replace(/\r\n/g, '\n').split('\n');
  const filteredLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(?:Section|Exam Models|Integrated Question Bank|Questions?\s*Bank|Pre-clinical|\d{1,4}\s+Exam Models|\d{2,4})$/i.test(line)) {
      continue;
    }
    if (/^Your Daily Dose Of Progress/i.test(line) || /^\d+\s*(?:st|nd|rd|th)?\s*Medical Year/i.test(line)) {
      continue;
    }
    filteredLines.push(rawLine);
  }

  const cleanedText = filteredLines.join('\n').replace(/\.{4,}/g, '____');

  // Match numbered questions BOTH with delimiter (e.g. "1. ", "2) ") AND styled badge number + text ("1 Regarding...", "7 A 40-year-old...", "6 ____ is...")
  const qSplitRegex = /(?:^|\n)\s*(?:(?:Question|Q)\s*)?(\d{1,3})(?:[\.\)\:\-]\s+|\s+(?=(?:[A-Z](?:[a-zA-Z'"(\[\d]|\s+[a-zA-Z0-9])|_{3,})))/g;
  const rawMatches = Array.from(cleanedText.matchAll(qSplitRegex));

  // Filter out false question numbers (like "Exam 1", "8 Exam Models", "10 Marks", chemical formulas, section subheadings)
  const matches = rawMatches.filter((m) => {
    const num = parseInt(m[1], 10);
    if (num <= 0 || num > 350) return false;
    const afterText = cleanedText.slice(m.index! + m[0].length, m.index! + m[0].length + 35).trim();
    if (/^(?:End|Final|Exam|Module|Medical|Section|Questions?|Marks?|MCQs|Written|Answers?|Years?|Months?|Days?|Hours?|Weeks?|Minutes?|Times?|Cases?|Patients?)\b/i.test(afterText)) {
      return false;
    }
    return true;
  });

  if (matches.length === 0) {
    return [{
      questionNumber: 1,
      originalNumber: 1,
      stem: cleanPageNoise(cleanedText.slice(0, 800)),
      options: [],
      designatedAnswer: ''
    }];
  }

  const questions: Array<{
    questionNumber: number;
    originalNumber: number;
    stem: string;
    options: Array<{ label: string; text: string }>;
    designatedAnswer: string;
  }> = [];

  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const originalNum = parseInt(currentMatch[1], 10);
    const startIdx = currentMatch.index! + currentMatch[0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index! : cleanedText.length;

    // Look backward just before this question (or previous slice) to track current Exam Section & Written mode
    const contextLookback = cleanedText.slice(0, currentMatch.index!);
    const sectionMatches = Array.from(contextLookback.matchAll(/(?:^|\n)\s*Exam\s+\d+\s+([^\n]+)/gi));
    const latestSectionRaw = sectionMatches.length > 0 ? sectionMatches[sectionMatches.length - 1][1] : '';
    const latestSectionKey = normalizeSectionKey(latestSectionRaw);

    const lastMcqPos = Math.max(contextLookback.lastIndexOf('\nMCQs'), contextLookback.startsWith('MCQs') ? 0 : -1);
    const lastWrittenPos = Math.max(contextLookback.lastIndexOf('\nWritten'), contextLookback.startsWith('Written') ? 0 : -1);
    const inWrittenSection = lastWrittenPos > lastMcqPos;

    // Strip any trailing section header lines that landed at the bottom of the last question on a page
    let rawBlock = cleanedText.slice(startIdx, endIdx).trim();
    rawBlock = rawBlock.replace(/\n\s*(?:Exam\s+\d+.*|MCQs|Written)\s*$/gim, '').trim();
    const block = cleanPageNoise(rawBlock);
    if (block.length < 8) continue;

    // Look for explicit inline Answer designation e.g. "Answer: C" or "Ans: (B)" (must have word boundary + colon/dash so words like "organs", "viridans", "means:" never match!)
    let designatedAnswer = '';
    const ansMatch = block.match(/(?:^|\n|\s)\b(?:Answer|Ans|Key|Correct\s+Answer)\s*[:\-]\s*\(?([A-Ea-e](?:\s*,\s*[A-Ea-e])?)\)?(?!\s*[\.\)])(?=\s|$|\.|,)/i);
    if (ansMatch) {
      designatedAnswer = ansMatch[1].toUpperCase();
    }

    // Extract MCQ options: supports a. / a) / A. / A) / (a) across lines OR 2-column horizontal gaps (2+ spaces)
    let optRegex = /(?:^|\n|\s{2,})\(?([a-eA-E])[\.\)\:]\s+/g;
    let optMatches = Array.from(block.matchAll(optRegex));

    // Single-space inline fallback for "a) Foo b) Bar c) Baz d) Qux"
    if (optMatches.length < 2) {
      const inlineOptRegex = /(?:^|\s)\(?([a-eA-E])\)\s+/g;
      const inlineCandidates = Array.from(block.matchAll(inlineOptRegex));
      if (inlineCandidates.length >= 2 && inlineCandidates[0][1].toUpperCase() === 'A') {
        optMatches = inlineCandidates;
      }
    }

    let stem = block;
    let options: Array<{ label: string; text: string }> = [];

    const preOptionStem = optMatches.length > 0 ? block.slice(0, optMatches[0].index!).trim() : block;
    const isWrittenEssayHeader =
      (inWrittenSection || /\(\d+(?:\.\d+)?\s*marks?/i.test(block.slice(0, 320))) &&
      /\b(?:mention|discuss|compare|differentiate|enumerate|give reason|explain|describe|how to)\b/i.test(preOptionStem);

    const hasSequentialOptions =
      optMatches.length >= 2 &&
      optMatches.some(m => m[1].toUpperCase() === 'A') &&
      optMatches.some(m => m[1].toUpperCase() === 'B');

    if (hasSequentialOptions && !isWrittenEssayHeader) {
      stem = preOptionStem;

      for (let j = 0; j < optMatches.length; j++) {
        const curOpt = optMatches[j];
        const label = curOpt[1].toUpperCase();
        const optStart = curOpt.index! + curOpt[0].length;
        const optEnd = j + 1 < optMatches.length ? optMatches[j + 1].index! : block.length;
        let optText = block.slice(optStart, optEnd).trim();

        if (ansMatch && optText.includes(ansMatch[0])) {
          optText = optText.replace(ansMatch[0], '').trim();
        }
        optText = cleanPageNoise(optText).replace(/\s+/g, ' ').trim();

        if (optText.length > 0 && !options.some(o => o.label === label)) {
          options.push({ label, text: optText });
        }
      }

      // Normalize 2-column order (e.g. A, C, B, D -> A, B, C, D)
      options.sort((x, y) => x.label.localeCompare(y.label));
    } else {
      const looksLikeQuestion =
        /\?/.test(block) ||
        /\(\d+\s*marks?\)/i.test(block) ||
        inWrittenSection ||
        /\b(?:what|which|who|when|where|why|how|mention|discuss|compare|differentiate|enumerate|explain|give reason|describe|define|calculate|identify)\b/i.test(block.slice(0, 120));

      const isAnswerBulletFragment = !looksLikeQuestion && block.length < 180;
      if (isAnswerBulletFragment) continue;
      if (/^(?:diagnosis|identify|describe the slide)\s*$/i.test(block)) continue;
    }

    // Match designated answer from parsed Answer Key section if not present inline
    if (!designatedAnswer && options.length >= 2 && !inWrittenSection && orderedSections.length > 0) {
      let matchedMap = latestSectionKey ? sectionAnswers.get(latestSectionKey) : undefined;
      if (!matchedMap && latestSectionKey) {
        const found = orderedSections.find(s => s.key.includes(latestSectionKey) || latestSectionKey.includes(s.key));
        if (found) matchedMap = found.answers;
      }
      if (!matchedMap && orderedSections.length === 1) {
        matchedMap = orderedSections[0].answers;
      }
      if (matchedMap && matchedMap[originalNum]) {
        designatedAnswer = matchedMap[originalNum];
      }
    }

    if (ansMatch && stem.includes(ansMatch[0])) {
      stem = stem.replace(ansMatch[0], '').trim();
    }

    stem = stem.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (stem.length < 10) continue;

    questions.push({
      questionNumber: questions.length + 1,
      originalNumber: originalNum,
      stem,
      options,
      designatedAnswer
    });
  }

  return questions;
}
