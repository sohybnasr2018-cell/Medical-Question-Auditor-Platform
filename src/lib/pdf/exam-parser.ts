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
  if (
    /\b(?:(?:in|from|on)\s+the\s+(?:figure|diagram|graph|picture|image|photo|chart|slide|table|x[\s-]?ray|radiograph|ct|mri|ultrasound|ecg|ekg|smear|section|tracing|loop|pedigree)|(?:this|the\s+following|accompanying|attached)\s+(?:figure|diagram|graph|picture|image|photo|micrograph|photomicrograph|slide|x[\s-]?ray|radiograph|ct|mri|ultrasound|ecg|ekg|tracing|pedigree|karyotype|histology|smear|biopsy|lesion|specimen|chart|curve)|which\s+curve|shown\s+(?:in|above|below|here)|illustrated\s+(?:in|above|below|here)|seen\s+(?:above|below|here|in\s+(?:this|the)\s+(?:slide|smear|x[\s-]?ray|radiograph|ct|mri|ecg|ultrasound|biopsy|section|image|figure))|curve\s+[A-Za-z0-9]|blood\s+film\s+picture|peripheral\s+(?:blood\s+)?smear\s+(?:shows|demonstrates|below|above)|microscopic\s+picture|csf\s+picture|slide\s*\d+|describe\s+the\s+slide|spotter|radiograph|x[\s-]?ray|echocardiogram|rhythm\s+strip|ecg\s+strip|flow[\s-]?volume|pressure[\s-]?volume|spirometry|kaplan[\s-]?meier|karyotype|pedigree|audiogram|electrophoresis|western\s+blot|chromatogram|photomicrograph|microphotograph|indicated\s+by\s+(?:the\s+)?arrow|arrowhead|pointed\s+to|figure\s*\d+|fig\.?\s*\d+)\b/i.test(combined)
  ) {
    return true;
  }
  if (/^\s*(?:1[\.\)]\s*)?(?:identify|diagnosis|spot)\b/i.test(stem || '')) {
    return true;
  }
  return false;
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

interface FooterAnswerPair {
  num: number;
  ans: string;
  used?: boolean;
}

/**
 * Parse horizontal paired answer keys on a single line (e.g. "10 C 11 C ... 16 A,C 17 A" or "1 C").
 * Single-pair lines are accepted only when allowSinglePair is true (bottom footer zone of a page).
 */
function parseAnswerPairLine(line: string, allowSinglePair: boolean): FooterAnswerPair[] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 260) return null;
  if (/\)\s+[a-zA-Z]{2,}/.test(trimmed)) return null;

  const pairRegex = /\b(\d{1,3})\s*[\.\:\-\)]?\s*([a-eA-E](?:\s*,\s*[a-eA-E])*)\b(?!\s*[a-zA-Z]{2,})/g;
  const matches = Array.from(trimmed.matchAll(pairRegex));
  const minPairs = allowSinglePair ? 1 : 2;
  if (matches.length < minPairs) return null;

  const leftover = trimmed
    .replace(pairRegex, '')
    .replace(/[\s|,;:\-\[\]\(\)]+/g, '');
  if (leftover.length > (allowSinglePair ? 0 : 4)) return null;

  const out: FooterAnswerPair[] = [];
  for (const m of matches) {
    const qNum = parseInt(m[1], 10);
    if (qNum <= 0 || qNum > 500) continue;
    const ansClean = m[2]
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
      .join(', ');
    if (ansClean) {
      out.push({ num: qNum, ans: ansClean });
    }
  }
  return out.length >= minPairs ? out : null;
}

function parseTwoRowKeyPair(numRow: string, letterRow: string, minCols: number): FooterAnswerPair[] | null {
  const nTrim = numRow.trim();
  const lTrim = letterRow.trim();
  if (!/^\d{1,3}(?:\s+\d{1,3})*$/.test(nTrim)) return null;
  if (!/^[a-eA-E](?:\s*,\s*[a-eA-E])*(?:\s+[a-eA-E](?:\s*,\s*[a-eA-E])*)*$/.test(lTrim)) return null;

  const nums = nTrim.split(/\s+/).map(n => parseInt(n, 10));
  const lets = lTrim.split(/\s+/).map(c => c.split(',').map(x => x.trim().toUpperCase()).filter(Boolean).join(', '));
  if (nums.length < minCols || nums.length !== lets.length) return null;

  const pairs: FooterAnswerPair[] = [];
  for (let k = 0; k < nums.length; k++) {
    if (nums[k] > 0 && nums[k] <= 500 && lets[k]) {
      pairs.push({ num: nums[k], ans: lets[k] });
    }
  }
  return pairs.length >= minCols ? pairs : null;
}

/**
 * Normalize margin collisions & strip per-page chrome/footer answer strips cleanly on every page
 * BEFORE assembling the document stream, preserving exact page-scoped footer keys so resetting
 * section question numbers ("Part 1: 1..17", "Part 2: 1..20") never overwrite each other.
 */
const APPENDIX_HEADING_REGEX =
  /^\s*(?:Answers?|Answer\s+Keys?|Model\s+Answers?|Solutions?|Key\s+to\s+Questions)\s*:?\s*$/i;

function preprocessExamPages(
  pages: Array<{ pdfPageIndex: number; text: string }>
): {
  markedRawText: string;
  pageFooterKeys: Map<number, FooterAnswerPair[]>;
} {
  const pageFooterKeys = new Map<number, FooterAnswerPair[]>();
  const processedPages: string[] = [];
  let inAnswerAppendix = false;

  for (const page of pages) {
    const pageLines = (page.text || '').replace(/\r\n/g, '\n').split('\n');
    const cleanLines: string[] = [];

    // First clean margin artifacts and sidebar chrome lines while keeping footer strips visible
    for (const rawLine of pageLines) {
      let line = rawLine
        // Recover question numbers colliding with left vertical banner text ("nd 2) ...", "2 5) ...")
        .replace(/^\s*(?:1st|2nd|3rd|\dth|nd|st|rd|th|\d{1,2})\s{2,}(\d{1,3}[\.\)]\s+)/i, '$1')
        // Strip right-margin sidebar labels appended after wide horizontal gaps
        .replace(/\s{3,}(?:MODULE|HEMA|CVS|GIT|CNS|MSK|RESP|RENAL)\s*$/g, '');

      const t = line.trim();
      if (!t) continue;
      if (
        /^(?:BOOK SERIES|MCQ,\s*PRACTICAL.*|YEAR\s*\|\s*.*MODULE.*|HEMA|MODULE|\||nd|st|rd|th|\d{1,4}\s+(?:PARASITOLOGY|PHARMACOLOGY|PATHOLOGY|ANATOMY|PHYSIOLOGY|HISTOLOGY|BIOCHEMISTRY|MICROBIOLOGY|IMMUNOLOGY|HEMATOLOGY|EMBRYOLOGY|CARDIOLOGY))$/i.test(t) ||
        /^(?:Section|Exam Models|Integrated Question Bank|Questions?\s*Bank|Pre-clinical|\d{1,4}\s+Exam Models|\d{2,4})$/i.test(t) ||
        /^Your Daily Dose Of Progress/i.test(t) ||
        /^\d+\s*(?:st|nd|rd|th)?\s*Medical Year/i.test(t)
      ) {
        continue;
      }

      cleanLines.push(line);
    }

    const pageHasMcqChoices =
      cleanLines.some(l => /^\s*\(?a[\.\)\:]\s+/i.test(l)) &&
      cleanLines.some(l => /^\s*\(?b[\.\)\:]\s+/i.test(l));
    const headingIdxOnPage = cleanLines.findIndex(l => APPENDIX_HEADING_REGEX.test(l.trim()));

    if (headingIdxOnPage >= 0 && !pageHasMcqChoices) {
      inAnswerAppendix = true;
    } else if (pageHasMcqChoices && headingIdxOnPage < 0) {
      inAnswerAppendix = false;
    }

    // Never strip rows inside an Answers/Key appendix page; preserve them intact for splitAndParseAnswerKeys
    const footerSearchStopIdx = headingIdxOnPage >= 0 ? headingIdxOnPage : inAnswerAppendix ? cleanLines.length : 0;
    if (inAnswerAppendix && headingIdxOnPage < 0) {
      processedPages.push(`<<<PAGE:${page.pdfPageIndex}>>>\n${cleanLines.join('\n')}`);
      continue;
    }

    // Extract page-footer answer strips above any appendix start (2-row grids, 2+ pairs, or 1 bottom pair)
    const pairsOnPage: FooterAnswerPair[] = [];
    const bodyLines: string[] = [];
    let sawFooterStripOnPage = false;

    const scanLimitIdx = headingIdxOnPage >= 0 ? headingIdxOnPage : cleanLines.length;
    const keepMask = new Array(cleanLines.length).fill(true);
    for (let idx = scanLimitIdx - 1; idx >= 0; idx--) {
      if (headingIdxOnPage >= 0 && idx >= footerSearchStopIdx) continue;
      const t = cleanLines[idx].trim();
      const inBottomZone = idx >= scanLimitIdx - 6 || sawFooterStripOnPage;

      // Support 2-row answer boxes at the bottom of a page (nums row above letters row)
      const minGridCols = idx >= scanLimitIdx - 4 ? 1 : 2;
      if (inBottomZone && idx >= 1 && parseTwoRowKeyPair(cleanLines[idx - 1], t, minGridCols)) {
        keepMask[idx] = false;
        keepMask[idx - 1] = false;
        sawFooterStripOnPage = true;
        idx--; // also consume nums row
        continue;
      }

      const multiPairs = parseAnswerPairLine(t, false);
      if (multiPairs) {
        keepMask[idx] = false;
        sawFooterStripOnPage = true;
        continue;
      }
      if (inBottomZone) {
        const singlePair = parseAnswerPairLine(t, true);
        if (singlePair) {
          keepMask[idx] = false;
          sawFooterStripOnPage = true;
        }
      }
    }

    // Collect footer pairs in exact top-to-bottom order for this page
    for (let idx = 0; idx < cleanLines.length; idx++) {
      if (!keepMask[idx]) {
        const curT = cleanLines[idx].trim();
        const twoRowPairs =
          idx + 1 < cleanLines.length && !keepMask[idx + 1]
            ? parseTwoRowKeyPair(curT, cleanLines[idx + 1], 1)
            : null;
        if (twoRowPairs) {
          pairsOnPage.push(...twoRowPairs);
          idx++; // skip consumed letters row
          continue;
        }
        const parsed = parseAnswerPairLine(curT, true);
        if (parsed) pairsOnPage.push(...parsed);
      } else {
        bodyLines.push(cleanLines[idx]);
      }
    }

    if (headingIdxOnPage >= 0) {
      inAnswerAppendix = true;
    }

    if (pairsOnPage.length > 0) {
      pageFooterKeys.set(page.pdfPageIndex, pairsOnPage);
    }

    processedPages.push(`<<<PAGE:${page.pdfPageIndex}>>>\n${bodyLines.join('\n')}`);
  }

  return {
    markedRawText: processedPages.join('\n'),
    pageFooterKeys
  };
}

function consumeFooterAnswer(
  pageFooterKeys: Map<number, FooterAnswerPair[]>,
  sourcePageIndex: number,
  endPageIndex: number,
  originalNum: number
): string {
  const pagesToTry = endPageIndex > sourcePageIndex
    ? [sourcePageIndex, endPageIndex]
    : [sourcePageIndex];

  for (const pIdx of pagesToTry) {
    const queue = pageFooterKeys.get(pIdx);
    if (!queue) continue;
    const hit = queue.find(item => !item.used && item.num === originalNum);
    if (hit) {
      hit.used = true;
      return hit.ans;
    }
  }
  return '';
}

/**
 * Parse end-of-book / section "Answers / Answer Key / Model Answer" blocks in grid, horizontal, or vertical formats
 * and return both section maps and body text with the answer appendix stripped.
 */
function splitAndParseAnswerKeys(rawText: string): {
  bodyText: string;
  sectionAnswers: Map<string, Record<number, string>>;
  orderedSections: Array<{ key: string; answers: Record<number, string> }>;
} {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const headingMatches = Array.from(
    normalized.matchAll(/(?:^|\n)\s*(?:Answers?|Answer\s+Keys?|Model\s+Answers?|Solutions?|Key\s+to\s+Questions)\s*:?\s*\n/gi)
  );

  for (const ansHeadingMatch of headingMatches) {
    if (ansHeadingMatch.index === undefined) continue;

    const splitPos = ansHeadingMatch.index;
    const candidateAppendix = normalized.slice(splitPos + ansHeadingMatch[0].length);
    const lines = candidateAppendix.split('\n').map(l => l.trim()).filter(Boolean);

    const sectionAnswers = new Map<string, Record<number, string>>();
    const orderedSections: Array<{ key: string; answers: Record<number, string> }> = [];

    let currentKey = 'default';
    let currentMap: Record<number, string> = {};
    let totalParsedCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip running page headers inside answer pages
      if (/^(?:Pre-clinical|Question Bank|Your Daily Dose|Exam Models|Integrated Question Bank|Section|\d+\s+Exam Models|\d+\s*(?:nd|rd|st|th)?\s*Medical Year|<<<PAGE:\d+>>>)/i.test(line)) {
        continue;
      }

      // Section heading inside Answers e.g. "1. End Module 2022" or "Final 2025" or "Part 2"
      if (/^(?:\d+\.\s*)?(?:End\s+Module|Final|Midterm|Exam|Quiz|Model|Part|Section|Topic|Chapter)\b/i.test(line)) {
        if (Object.keys(currentMap).length > 0) {
          sectionAnswers.set(currentKey, currentMap);
          orderedSections.push({ key: currentKey, answers: currentMap });
        }
        currentKey = normalizeSectionKey(line) || `section_${orderedSections.length + 1}`;
        currentMap = {};
        continue;
      }

      // Format 1: Paired 2-row grid (numbers row followed by answer letters row)
      if (i + 1 < lines.length) {
        const twoRowPairs = parseTwoRowKeyPair(line, lines[i + 1], 2);
        if (twoRowPairs) {
          for (const p of twoRowPairs) {
            currentMap[p.num] = p.ans;
            totalParsedCount++;
          }
          i++; // skip consumed letters row
          continue;
        }
      }

      // Format 2: Horizontal or vertical key pairs ("1. B 2. C", "1-B", "1: C", "1) D", "1 A,C")
      const linePairs = parseAnswerPairLine(line, true);
      if (linePairs) {
        for (const p of linePairs) {
          currentMap[p.num] = p.ans;
          totalParsedCount++;
        }
      }
    }

    if (Object.keys(currentMap).length > 0) {
      sectionAnswers.set(currentKey, currentMap);
      orderedSections.push({ key: currentKey, answers: currentMap });
    }

    if (totalParsedCount >= 3) {
      return { bodyText: normalized.slice(0, splitPos), sectionAnswers, orderedSections };
    }
  }

  return { bodyText: normalized, sectionAnswers: new Map(), orderedSections: [] };
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
  // Primary: line-start or wide multi-space column gap before option marker (with optional * / checkmark)
  const primaryRegex = /(?:^|\n|\s{2,})(?:[*✓✔☑✅]\s*)?\(?([a-eA-E])[\.\)\:]\s+(?!g\.)/g;
  const primaryMatches = Array.from(block.matchAll(primaryRegex));

  // Secondary: handle 2-column OCR lines separated by only 1 space after sentence punctuation (e.g. "...alkaline medium. c. Are highly...")
  const inlineColRegex = /(?<=[.?!;)\d]\s+)(?:[*✓✔☑✅]\s*)?\(?([b-eB-E])[\.\)]\s+(?=[A-Za-z0-9<>\(\["'])/g;
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
    const inlineOptRegex = /(?:^|\s)(?:[*✓✔☑✅]\s*)?\(?([a-eA-E])\)\s+/g;
    const inlineCandidates = Array.from(block.matchAll(inlineOptRegex));
    if (inlineCandidates.length >= 2 && inlineCandidates[0][1].toUpperCase() === 'A') {
      return inlineCandidates;
    }
  }

  return primaryMatches;
}

const INLINE_ANSWER_REGEX =
  /(?:^|\n|\s)\b(?:Answer(?:\s+Key)?|Ans|Correct\s+(?:Answer|Choice|Option)|Key|Model\s+Answer|Solution)\s*[:\-=]\s*\(?([A-Ea-e](?:\s*[,&]\s*[A-Ea-e])*)\)?(?!\s*[\.\)])(?=\s|$|\.|,)/i;

function normalizeMultiKeyLetters(raw: string): string {
  return Array.from(
    new Set(
      raw
        .split(/[,&]+/)
        .map(s => s.trim().toUpperCase())
        .filter(s => /^[A-E]$/.test(s))
    )
  ).join(', ');
}

/**
 * Shared option + inline answer extractor that captures explicit "Answer: X" keys as well as
 * inline option checkmarks/stars/tags (e.g. "* a) ...", "b) ... ✓", "[correct]") and strips
 * answer glyphs cleanly from extracted choice strings.
 */
function extractInlineAnswerAndOptions(
  block: string,
  respectEssayHeader: boolean,
  inWrittenSection: boolean
): {
  stem: string;
  options: Array<{ label: string; text: string }>;
  designatedAnswer: string;
  isWrittenQuestion: boolean;
} {
  const ansMatch = block.match(INLINE_ANSWER_REGEX);
  let designatedAnswer = ansMatch ? normalizeMultiKeyLetters(ansMatch[1]) : '';
  const optMatches = findOptionMatchesInBlock(block);
  const preOptionStem = optMatches.length > 0 ? block.slice(0, optMatches[0].index!).trim() : block;

  const isWrittenEssayHeader = respectEssayHeader &&
    (inWrittenSection || /\(\d+(?:\.\d+)?\s*marks?/i.test(block.slice(0, 320))) &&
    /\b(?:mention|discuss|compare|differentiate|enumerate|give reason|explain|describe|how to)\b/i.test(preOptionStem);

  const hasSequentialOptions =
    optMatches.length >= 2 &&
    optMatches.some(m => m[1].toUpperCase() === 'A') &&
    optMatches.some(m => m[1].toUpperCase() === 'B');

  let stem = block;
  const options: Array<{ label: string; text: string }> = [];
  const checkMarkedLetters: string[] = [];

  if (hasSequentialOptions && !isWrittenEssayHeader) {
    stem = preOptionStem;

    for (let j = 0; j < optMatches.length; j++) {
      const curOpt = optMatches[j];
      const label = curOpt[1].toUpperCase();
      const hasLeadingMark = /[*✓✔☑✅]/.test(curOpt[0]);
      const optStart = curOpt.index! + curOpt[0].length;
      const optEnd = j + 1 < optMatches.length ? optMatches[j + 1].index! : block.length;
      let optText = block.slice(optStart, optEnd).trim();

      if (ansMatch && optText.includes(ansMatch[0])) {
        optText = optText.replace(ansMatch[0], '').trim();
      }
      const hasTrailingMark =
        /(?:[✓✔☑✅]|\(\s*[✓✔☑✅]\s*\)|\[\s*correct(?:\s+answer)?\s*\]|\(\s*correct(?:\s+answer)?\s*\))\s*$/i.test(optText);

      if ((hasLeadingMark || hasTrailingMark) && !checkMarkedLetters.includes(label)) {
        checkMarkedLetters.push(label);
      }

      optText = optText
        .replace(/(?:[✓✔☑✅]|\(\s*[✓✔☑✅]\s*\)|\[\s*correct(?:\s+answer)?\s*\]|\(\s*correct(?:\s+answer)?\s*\))\s*$/gi, '')
        .trim();
      optText = cleanPageNoise(optText).replace(/\s+/g, ' ').trim();

      if (optText.length > 0 && !options.some(o => o.label === label)) {
        options.push({ label, text: optText });
      }
    }
    options.sort((x, y) => x.label.localeCompare(y.label));
  }

  if (!designatedAnswer && checkMarkedLetters.length > 0) {
    designatedAnswer = checkMarkedLetters.join(', ');
  }

  if (ansMatch && stem.includes(ansMatch[0])) {
    stem = stem.replace(ansMatch[0], '').trim();
  }

  return {
    stem,
    options,
    designatedAnswer,
    isWrittenQuestion: !hasSequentialOptions || isWrittenEssayHeader
  };
}

/**
 * Fallback question segmenter driven by MCQ option clusters (a..d/e) instead of leading numbers.
 * Recovers every question cleanly when exam numbers are inside colored circles, garbled by OCR, or omitted.
 */
function segmentBlocksByOptionClusters(
  cleanedText: string
): Array<{ rawBlock: string; originalNum: number; sourcePageIndex: number; endPageIndex: number }> {
  const lines = cleanedText.split('\n');
  const results: Array<{ rawBlock: string; originalNum: number; sourcePageIndex: number; endPageIndex: number }> = [];

  let curStart = 0;
  let curPage = 1;
  let curStartPage = 1;
  let seenLetters = new Set<string>();
  let lastOptionLine = -1;

  const extractLastPage = (rawSlice: string, fallbackPage: number): number => {
    const tags = Array.from(rawSlice.matchAll(/<<<PAGE:(\d+)>>>/g));
    return tags.length > 0 ? parseInt(tags[tags.length - 1][1], 10) : fallbackPage;
  };

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
    if (parseAnswerPairLine(trimmed, false)) {
      if (lastOptionLine >= curStart) {
        const rawSlice = lines.slice(curStart, lastOptionLine + 1).join('\n');
        results.push({
          rawBlock: rawSlice.replace(/<<<PAGE:\d+>>>/g, '').trim(),
          originalNum: results.length + 1,
          sourcePageIndex: curStartPage,
          endPageIndex: extractLastPage(rawSlice, curStartPage)
        });
        curStart = idx + 1;
        curStartPage = curPage;
        seenLetters.clear();
        lastOptionLine = -1;
      }
      continue;
    }

    const lineStartOpt = trimmed.match(/^(?:[*✓✔☑✅]\s*)?\(?([a-eA-E])[\.\)\:]\s+(?!g\.)/);
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
        const rawSlice = lines.slice(curStart, splitAt).join('\n');
        const block = rawSlice.replace(/<<<PAGE:\d+>>>/g, '').trim();
        const leadingNumMatch = block.match(/^(?:Question|Q)?\s*(\d{1,3})(?=[\.\)\:\s])/i);
        results.push({
          rawBlock: block,
          originalNum: leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : results.length + 1,
          sourcePageIndex: curStartPage,
          endPageIndex: extractLastPage(rawSlice, curStartPage)
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

    const markersInLine = Array.from(trimmed.matchAll(/(?:^|\s{2,}|(?<=[.?!;)\d]\s+))(?:[*✓✔☑✅]\s*)?\(?([a-eA-E])[\.\)\:]\s+(?!g\.)/g));
    if (lineStartOpt || (markersInLine.length > 0 && seenLetters.size > 0)) {
      for (const m of markersInLine) {
        seenLetters.add(m[1].toUpperCase());
      }
      lastOptionLine = idx;
    }
  }

  if (curStart < lines.length) {
    const tailEnd = lastOptionLine >= curStart ? lastOptionLine + 1 : lines.length;
    const rawSlice = lines.slice(curStart, tailEnd).join('\n');
    const tail = rawSlice.replace(/<<<PAGE:\d+>>>/g, '').trim();
    if (tail.length >= 12) {
      const leadingNumMatch = tail.match(/^(?:Question|Q)?\s*(\d{1,3})(?=[\.\)\:\s])/i);
      results.push({
        rawBlock: tail,
        originalNum: leadingNumMatch ? parseInt(leadingNumMatch[1], 10) : results.length + 1,
        sourcePageIndex: curStartPage,
        endPageIndex: extractLastPage(rawSlice, curStartPage)
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
  const { markedRawText, pageFooterKeys } = preprocessExamPages(pages);
  const { bodyText, sectionAnswers, orderedSections } = splitAndParseAnswerKeys(markedRawText);

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
    if (/^(?:End\s+Module|Final\s+\d+|Exam\s+\d+|Module|MCQs|Written|Answer\s+Keys?)\b/i.test(afterText)) {
      return false;
    }
    const hasDelimiter = /[\.\)\:\-]\s*$/.test(m[0]);
    if (
      !hasDelimiter &&
      /^(?:End|Final|Exam|Medical|Section|Questions?|Marks?|Answers?|Years?|Months?|Days?|Hours?|Weeks?|Minutes?|Times?|Cases?|Patients?)\b/i.test(afterText)
    ) {
      return false;
    }
    return true;
  });

  const resolveAppendixAnswer = (latestSecKey: string, origNum: number): string => {
    if (orderedSections.length === 0) return '';
    let matchedMap = latestSecKey ? sectionAnswers.get(latestSecKey) : undefined;
    if (!matchedMap && latestSecKey) {
      const found = orderedSections.find(s => s.key.includes(latestSecKey) || latestSecKey.includes(s.key));
      if (found) matchedMap = found.answers;
    }
    if (!matchedMap && orderedSections.length === 1) {
      matchedMap = orderedSections[0].answers;
    }
    return (matchedMap && matchedMap[origNum]) || '';
  };

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

      const extracted = extractInlineAnswerAndOptions(block, false, false);
      let designatedAnswer = extracted.designatedAnswer;
      const options = extracted.options;

      if (!designatedAnswer && options.length >= 2) {
        designatedAnswer =
          consumeFooterAnswer(pageFooterKeys, seg.sourcePageIndex, seg.endPageIndex, seg.originalNum) ||
          resolveAppendixAnswer('', seg.originalNum);
      }

      const stem = stripLeadingOcrBadge(extracted.stem).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
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
    const rawPageTags = Array.from(rawBlock.matchAll(/<<<PAGE:(\d+)>>>/g));
    const endPageIndex = rawPageTags.length > 0
      ? parseInt(rawPageTags[rawPageTags.length - 1][1], 10)
      : sourcePageIndex;
    rawBlock = rawBlock.replace(/\n\s*(?:Exam\s+\d+.*|MCQs|Written)\s*$/gim, '').trim();
    const block = cleanPageNoise(rawBlock);
    if (block.length < 8) continue;

    const extracted = extractInlineAnswerAndOptions(block, true, inWrittenSection);
    let designatedAnswer = extracted.designatedAnswer;
    const options = extracted.options;
    let stem = extracted.stem;

    if (extracted.isWrittenQuestion) {
      const looksLikeQuestion =
        /\?/.test(block) ||
        /\(\d+\s*marks?\)/i.test(block) ||
        inWrittenSection ||
        /\b(?:what|which|who|when|where|why|how|mention|discuss|compare|differentiate|enumerate|explain|give reason|describe|define|calculate|identify)\b/i.test(block.slice(0, 120));

      const isAnswerBulletFragment = !looksLikeQuestion && block.length < 180;
      if (isAnswerBulletFragment) continue;
      if (/^(?:diagnosis|identify|describe the slide)\s*$/i.test(block)) continue;
    }

    // Match designated answer from parsed Answer Key section or page-scoped horizontal strip if not present inline
    if (!designatedAnswer && options.length >= 2 && !inWrittenSection) {
      designatedAnswer =
        consumeFooterAnswer(pageFooterKeys, sourcePageIndex, endPageIndex, originalNum) ||
        resolveAppendixAnswer(latestSectionKey, originalNum);
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
