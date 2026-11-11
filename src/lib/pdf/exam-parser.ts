/**
 * Medical Examination Questions Parser
 * Extracts individual stems, choices (a/b/c/d/e or A/B/C/D/E, single- or two-column),
 * written/essay questions, and designated answer keys (inline, page-footer strips, or end-of-book matrices).
 */

export interface ParsedExamQuestion {
  questionNumber: number;
  originalNumber: number;
  stem: string;
  options: Array<{ label: string; text: string }>;
  designatedAnswer: string;
  sourcePageIndex?: number;
  imagePath?: string;
  imageDescription?: string;
}

/**
 * Determine whether a question explicitly refers to an accompanying figure, graph,
 * microscopic slide, photograph, radiograph, ECG tracing, or visual specimen.
 */
export function questionReferencesVisualFigure(
  stem: string,
  options?: Array<{ label: string; text: string }>
): boolean {
  const combined = `${stem || ''} ${(options || []).map(o => o.text).join(' ')}`;
  return /\b(?:in\s+the\s+(?:figure|diagram|graph|picture|image|photo|chart|slide|x[\s-]?ray|ecg)|the\s+following\s+(?:figure|diagram|graph|picture|image|photo|micrograph|slide)|which\s+curve|shown\s+(?:in|above|below)|curve\s+[A-Za-z0-9]|blood\s+film\s+picture|microscopic\s+picture|csf\s+picture|slide\s*\d+|describe\s+the\s+slide|figure\s*\d*|fig\.?\s*\d*)\b/i.test(combined);
}

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
 * Parse horizontal paired answer strips (e.g. "98 b  99 a  100 d  101 d") commonly placed in page footers.
 */
function parseHorizontalAnswerPairs(text: string): Record<number, string> {
  const map: Record<number, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length > 220) continue;
    const pairs = Array.from(line.matchAll(/\b(\d{1,3})\s*[\.\:\-\)]?\s*([a-eA-E])\b(?!\s*[a-zA-Z]{2,})/g));
    // Require at least 3 key pairs on the same strip so normal prose (e.g. "4 hours") never triggers
    if (pairs.length >= 3) {
      const leftover = line.replace(/\b\d{1,3}\s*[\.\:\-\)]?\s*[a-eA-E]\b/g, '').replace(/[\s|,;:\-\[\]\(\)]+/g, '');
      if (leftover.length <= 6) {
        for (const p of pairs) {
          const qNum = parseInt(p[1], 10);
          if (qNum > 0 && qNum <= 500) {
            map[qNum] = p[2].toUpperCase();
          }
        }
      }
    }
  }
  return map;
}

/**
 * Parse end-of-book "Answers / Answer Key" matrix sections (e.g. "1. End Module 2022" -> { 1: 'A', 2: 'C', ... })
 * and return both the key map and the body text with the answer appendix removed.
 */
function splitAndParseAnswerKeys(rawText: string): {
  bodyText: string;
  sectionAnswers: Map<string, Record<number, string>>;
  orderedSections: Array<{ key: string; answers: Record<number, string> }>;
  horizontalAnswers: Record<number, string>;
} {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const horizontalAnswers = parseHorizontalAnswerPairs(normalized);
  const ansHeadingMatch = normalized.match(/(?:^|\n)\s*(?:Answers?|Answer\s+Keys?)\s*\n/i);

  if (!ansHeadingMatch || ansHeadingMatch.index === undefined) {
    return { bodyText: normalized, sectionAnswers: new Map(), orderedSections: [], horizontalAnswers };
  }

  // Only treat as an appendix if it appears in the latter half of the document and contains grid rows
  const splitPos = ansHeadingMatch.index;
  const candidateAppendix = normalized.slice(splitPos + ansHeadingMatch[0].length);
  const hasAnswerGrid = /\b1\s+2\s+3\b/.test(candidateAppendix) && /(?:^|\n)\s*[a-eA-E](?:\s+[a-eA-E]){2,}/.test(candidateAppendix);

  if (!hasAnswerGrid) {
    return { bodyText: normalized, sectionAnswers: new Map(), orderedSections: [], horizontalAnswers };
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

  return { bodyText, sectionAnswers, orderedSections, horizontalAnswers };
}

function cleanPageNoise(text: string): string {
  return text
    .replace(/<<<PAGE:\d+>>>/g, '')
    .replace(/\.{4,}/g, ' ____ ')
    .replace(/^\s*Question\s+[IVXLC]+\s*[:\-].*$/gim, '')
    .replace(/^\s*(?:Section|Exam Models|Integrated Question Bank|Questions?\s*Bank|Pre-clinical|MCQs)\s*$/gim, '')
    .replace(/^\s*\d+\s+Exam Models.*$/gim, '')
    .replace(/^\s*Your Daily Dose Of Progress.*$/gim, '')
    .replace(/^\s*\d+\s*(?:st|nd|rd|th)?\s*Medical Year.*$/gim, '')
    .replace(/^\s*\d{2,4}\s*$/gm, '')
    // Drop standalone mangled OCR key-box footer junk lines without touching short option lines
    .replace(/^.*$/gm, (line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (/^\(?[a-eA-E][\.\)\:]\s+/.test(trimmed)) return line;
      if (/^(?:e|i|l)\s{2,}(?:e|i|l)$/i.test(trimmed)) return '';
      if (/\(o\s*[A-Za-z]{2,}/.test(trimmed) && !/\b[a-z]{4,}\b/.test(trimmed)) return '';
      return line;
    })
    .trim();
}

/**
 * Clean OCR-mangled colored-circle question badge glyphs or leading question numbers at line starts
 * (e.g. "@ ", "a Drugs", "w If", "98. ", "① ").
 */
function stripLeadingOcrBadge(stem: string): string {
  return stem
    .replace(/^\s*(?:Question|Q)?\s*\d{1,3}[\.\)\:\-]\s+/i, '')
    .replace(/^(?:[\u2460-\u2473\u24EA\u2776-\u277F@©®•\*]+|\([0-9]{1,3}\)|\[[0-9]{1,3}\])\s+/u, '')
    .replace(/^[a-z]\s+(?=[A-Z][a-zA-Z]{1,})/g, '')
    .trim();
}

function findOptionMatchesInBlock(block: string): RegExpMatchArray[] {
  // Primary: line-start or wide multi-space column gap before option marker
  const primaryRegex = /(?:^|\n|\s{2,})\(?([a-eA-E])[\.\)\:]\s+(?!g\.)/g;
  const primaryMatches = Array.from(block.matchAll(primaryRegex));

  // Secondary: handle 2-column OCR lines separated by only 1 space after sentence punctuation (e.g. "...alkaline medium. c. Are highly...")
  const inlineColRegex = /(?<=[.?!;)\d]\s+)\(?([b-eB-E])[\.\)]\s+(?=[A-Za-z0-9<>\(\["'])/g;
  const inlineColMatches = Array.from(block.matchAll(inlineColRegex)).filter((m) => {
    // Exclude uppercase chemical/drug labels like "Drug A.", "Vitamin C.", "Group B."
    const before = block.slice(Math.max(0, (m.index || 0) - 20), m.index || 0);
    if (/[A-Z][a-z]+\s+$/.test(before) && /^[A-E]$/.test(m[1])) {
      return false;
    }
    return true;
  });

  if (inlineColMatches.length > 0 && primaryMatches.some(m => m[1].toUpperCase() === 'A')) {
    const merged = [...primaryMatches, ...inlineColMatches]
      .sort((a, b) => (a.index || 0) - (b.index || 0));
    // Deduplicate overlapping indices
    const deduped: RegExpMatchArray[] = [];
    for (const m of merged) {
      if (deduped.length === 0 || (m.index || 0) > ((deduped[deduped.length - 1].index || 0) + 1)) {
        deduped.push(m);
      }
    }
    return deduped;
  }

  // Fallback for single-space inline options: "a) Foo b) Bar c) Baz d) Qux"
  if (primaryMatches.length < 2) {
    const inlineOptRegex = /(?:^|\s)\(?([a-eA-E])\)\s+/g;
    const inlineCandidates = Array.from(block.matchAll(inlineOptRegex));
    if (inlineCandidates.length >= 2 && inlineCandidates[0][1].toUpperCase() === 'A') {
      return inlineCandidates;
    }
  }

  return primaryMatches;
}

/**
 * Fallback question segmenter driven by MCQ option clusters (a..d/e) instead of leading numbers.
 * Recovers every question cleanly when exam numbers are inside colored circles, garbled by OCR, or omitted.
 */
function segmentBlocksByOptionClusters(
  cleanedText: string
): Array<{ rawBlock: string; originalNum: number; sourcePageIndex: number }> {
  const lines = cleanedText.split('\n');
  const results: Array<{ rawBlock: string; originalNum: number; sourcePageIndex: number }> = [];

  let curStart = 0;
  let curPage = 1;
  let curStartPage = 1;
  let seenLetters = new Set<string>();
  let lastOptionLine = -1;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const pageTag = trimmed.match(/^<<<PAGE:(\d+)>>>$/);
    if (pageTag) {
      curPage = parseInt(pageTag[1], 10);
      if (idx === curStart || seenLetters.size === 0) {
        curStartPage = curPage;
      }
      continue;
    }

    // Skip footer noise / horizontal answer key strips from forming bogus trailing text
    if (Object.keys(parseHorizontalAnswerPairs(trimmed)).length >= 3) {
      if (lastOptionLine >= curStart) {
        results.push({
          rawBlock: lines.slice(curStart, lastOptionLine + 1).join('\n'),
          originalNum: results.length + 1,
          sourcePageIndex: curStartPage
        });
        curStart = idx + 1;
        curStartPage = curPage;
        seenLetters.clear();
        lastOptionLine = -1;
      }
      continue;
    }

    const lineStartOpt = trimmed.match(/^\(?([a-eA-E])[\.\)\:]\s+(?!g\.)/);
    const leadLetter = lineStartOpt ? lineStartOpt[1].toUpperCase() : null;

    if (leadLetter === 'A' && seenLetters.size >= 2 && lastOptionLine >= curStart) {
      // Split between Question k's last option and Question k+1's stem
      let splitAt = lastOptionLine + 1;
      const gapCount = idx - splitAt;

      if (gapCount >= 2) {
        // Advance past any wrapped lowercase/incomplete continuation line of Question k's last option
        while (splitAt < idx - 1) {
          const prevLine = lines[splitAt - 1]?.trim() || '';
          const candidate = lines[splitAt]?.trim() || '';
          if (/^<<<PAGE:\d+>>>$/.test(candidate)) {
            splitAt++;
            continue;
          }
          const prevEndedClean = /[.?!:\)]$/.test(prevLine);
          const candidateStartsBadgeOrQ = /^(?:[@©®•\*]|\d{1,3}[\.\)\s]|[A-Z])/.test(candidate);
          if (!prevEndedClean && candidate && !candidateStartsBadgeOrQ) {
            splitAt++;
          } else {
            break;
          }
        }
      }

      if (splitAt > curStart) {
        const block = lines.slice(curStart, splitAt).join('\n').replace(/<<<PAGE:\d+>>>/g, '').trim();
        const leadingNumMatch = block.match(/^(?:Question|Q)?\s*(\d{1,3})(?=[\.\)\:\s])/i);
        results.push({
          rawBlock: block,
          originalNum: leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : results.length + 1,
          sourcePageIndex: curStartPage
        });
      }

      // Resolve page for next stem start line
      let nextPage = curPage;
      for (let k = splitAt; k >= 0; k--) {
        const m = (lines[k] || '').trim().match(/^<<<PAGE:(\d+)>>>$/);
        if (m) { nextPage = parseInt(m[1], 10); break; }
      }
      curStart = splitAt;
      curStartPage = nextPage;
      seenLetters.clear();
      lastOptionLine = -1;
    }

    const markersInLine = Array.from(trimmed.matchAll(/(?:^|\s{2,}|(?<=[.?!;)\d]\s+))\(?([a-eA-E])[\.\)\:]\s+(?!g\.)/g));
    if (lineStartOpt || (markersInLine.length > 0 && seenLetters.size > 0)) {
      for (const m of markersInLine) {
        seenLetters.add(m[1].toUpperCase());
      }
      lastOptionLine = idx;
    }
  }

  if (curStart < lines.length) {
    const tailEnd = lastOptionLine >= curStart ? lastOptionLine + 1 : lines.length;
    const tail = lines.slice(curStart, tailEnd).join('\n').replace(/<<<PAGE:\d+>>>/g, '').trim();
    if (tail.length >= 12) {
      const leadingNumMatch = tail.match(/^(?:Question|Q)?\s*(\d{1,3})(?=[\.\)\:\s])/i);
      results.push({
        rawBlock: tail,
        originalNum: leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : results.length + 1,
        sourcePageIndex: curStartPage
      });
    }
  }

  return results;
}

export function extractExamQuestionsFromText(rawText: string): ParsedExamQuestion[] {
  return extractExamQuestionsFromPages([{ pdfPageIndex: 1, text: rawText }]);
}

export function extractExamQuestionsFromPages(
  pages: Array<{ pdfPageIndex: number; text: string }>
): ParsedExamQuestion[] {
  const rawText = pages.map(p => `<<<PAGE:${p.pdfPageIndex}>>>\n${p.text || ''}`).join('\n');
  const { bodyText, sectionAnswers, orderedSections, horizontalAnswers } = splitAndParseAnswerKeys(rawText);

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

  // Count how many distinct "a." option blocks exist so circled/missing question numbers never collapse multiple questions into 1
  const optionStartCount = (cleanedText.match(/(?:^|\n)\s*\(?[aA][\.\)\:]\s+/g) || []).length;
  const useOptionAnchorFallback =
    matches.length === 0 || (optionStartCount >= 2 && optionStartCount > matches.length * 1.4);

  if (useOptionAnchorFallback) {
    const optionBlocks = segmentBlocksByOptionClusters(cleanedText);
    if (optionBlocks.length === 0) {
      return [{
        questionNumber: 1,
        originalNumber: 1,
        stem: stripLeadingOcrBadge(cleanPageNoise(cleanedText.slice(0, 800))),
        options: [],
        designatedAnswer: ''
      }];
    }

    const fallbackQuestions: ParsedExamQuestion[] = [];
    for (const seg of optionBlocks) {
      const block = cleanPageNoise(seg.rawBlock);
      if (block.length < 8) continue;

      let designatedAnswer = horizontalAnswers[seg.originalNum] || '';
      const ansMatch = block.match(/(?:^|\n|\s)\b(?:Answer|Ans|Key|Correct\s+Answer)\s*[:\-]\s*\(?([A-Ea-e](?:\s*,\s*[A-Ea-e])?)\)?(?!\s*[\.\)])(?=\s|$|\.|,)/i);
      if (ansMatch) {
        designatedAnswer = ansMatch[1].toUpperCase();
      }

      const optMatches = findOptionMatchesInBlock(block);
      const hasSequentialOptions =
        optMatches.length >= 2 &&
        optMatches.some(m => m[1].toUpperCase() === 'A') &&
        optMatches.some(m => m[1].toUpperCase() === 'B');

      let stem = hasSequentialOptions ? block.slice(0, optMatches[0].index!).trim() : block;
      const options: Array<{ label: string; text: string }> = [];

      if (hasSequentialOptions) {
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
        options.sort((x, y) => x.label.localeCompare(y.label));
      }

      if (ansMatch && stem.includes(ansMatch[0])) {
        stem = stem.replace(ansMatch[0], '').trim();
      }
      stem = stripLeadingOcrBadge(stem).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (stem.length < 8) continue;

      fallbackQuestions.push({
        questionNumber: fallbackQuestions.length + 1,
        originalNumber: seg.originalNum,
        stem,
        options,
        designatedAnswer,
        sourcePageIndex: seg.sourcePageIndex
      });
    }

    if (fallbackQuestions.length > 0) {
      return fallbackQuestions;
    }
  }

  const questions: ParsedExamQuestion[] = [];

  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const originalNum = parseInt(currentMatch[1], 10);
    const startIdx = currentMatch.index! + currentMatch[0].length;
    const endIdx = i + 1 < matches.length ? matches[i + 1].index! : cleanedText.length;

    // Look backward just before this question (or previous slice) to track current Exam Section, Page, & Written mode
    const contextLookback = cleanedText.slice(0, currentMatch.index!);
    const pageTagsBefore = Array.from(contextLookback.matchAll(/<<<PAGE:(\d+)>>>/g));
    const sourcePageIndex = pageTagsBefore.length > 0
      ? parseInt(pageTagsBefore[pageTagsBefore.length - 1][1], 10)
      : (pages[0]?.pdfPageIndex || 1);
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

    const optMatches = findOptionMatchesInBlock(block);

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

    // Match designated answer from parsed Answer Key section or horizontal strip if not present inline
    if (!designatedAnswer && options.length >= 2 && !inWrittenSection) {
      if (horizontalAnswers[originalNum]) {
        designatedAnswer = horizontalAnswers[originalNum];
      } else if (orderedSections.length > 0) {
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
      designatedAnswer,
      sourcePageIndex
    });
  }

  return questions;
}

/**
 * Detect whether an exam page's extracted text exhibits external-OCR corruption or dropped graphic question numbers/keys.
 */
export function hasExamOcrDegradationSignals(text: string): boolean {
  if (!text) return false;
  if (/(?:^|\n)\s*[@©®]\s+[A-Z]/.test(text)) return true;
  if (/(?:^|\n)\s*[a-z]\s+[A-Z][a-z]{2,}/.test(text)) return true;
  if (/\b(?:75|100|50|25)7\./.test(text) || /\bt\s*,\s*,?of\s*[&©]/i.test(text)) return true;
  if (/\(o\s*[A-Z]{2,}|il\s+RNl/i.test(text)) return true;
  const optStarts = (text.match(/(?:^|\n)\s*\(?[aA][\.\)\:]\s+/g) || []).length;
  const numStarts = (text.match(/(?:^|\n)\s*(?:Question|Q)?\s*\d{1,3}[\.\)\:\s]/g) || []).length;
  if (optStarts >= 2 && numStarts === 0) return true;
  return false;
}
