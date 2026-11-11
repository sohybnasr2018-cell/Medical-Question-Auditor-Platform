import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { openPdfForOcr, extractPdfPagePngBuffers } from './ocr';
import type { ParsedExamQuestion } from './exam-parser';

export interface StyledAnswerHint {
  originalNumber: number;
  answer: string;
  signal: 'bold_option' | 'colored_option';
}

export interface PdfPageVisualSignals {
  pageNumber: number;
  contentPngs: Buffer[];
  hasUniqueContentImages: boolean;
  hasHighlightOrCircleGraphics: boolean;
  hasOptionStyleVariance: boolean;
  styledAnswerHints: StyledAnswerHint[];
}

function sha1Hex(buf: Buffer): string {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

/**
 * Slices a subset of 1-based page numbers out of a PDF buffer into a standalone PDF buffer
 * using pure-JS pdf-lib (safe for both Node.js and Vercel serverless environments).
 */
export async function slicePdfPagesToBuffer(
  pdfBuffer: Buffer,
  pageNumbers1Based: number[]
): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const total = srcDoc.getPageCount();
  const validIndices = Array.from(new Set(pageNumbers1Based))
    .filter(n => Number.isFinite(n) && n >= 1 && n <= total)
    .sort((a, b) => a - b)
    .map(n => n - 1);

  if (validIndices.length === 0) {
    return pdfBuffer;
  }

  const outDoc = await PDFDocument.create();
  const copied = await outDoc.copyPages(srcDoc, validIndices);
  for (const p of copied) {
    outDoc.addPage(p);
  }
  const bytes = await outDoc.save();
  return Buffer.from(bytes);
}

/**
 * Identifies hashes of repeating headers, alternating odd/even banners, and watermarks across
 * sample pages so decorative template bitmaps are never mistakenly attached to exam questions.
 */
async function detectRepeatingTemplateHashes(pdfDoc: any, totalPages: number): Promise<Set<string>> {
  const repeated = new Set<string>();
  if (totalPages < 2) return repeated;

  const samplePages = [1, 2, 3, 4, 5, Math.min(totalPages, 6), totalPages]
    .filter((v, i, arr) => v >= 1 && v <= totalPages && arr.indexOf(v) === i);

  const hashPageCounts = new Map<string, number>();
  for (const pNum of samplePages) {
    const pngs = await extractPdfPagePngBuffers(pdfDoc, pNum);
    const seenOnPage = new Set<string>();
    for (const buf of pngs) {
      const h = sha1Hex(buf);
      if (seenOnPage.has(h)) continue;
      seenOnPage.add(h);
      hashPageCounts.set(h, (hashPageCounts.get(h) || 0) + 1);
    }
  }

  for (const [h, count] of hashPageCounts.entries()) {
    if (count >= 2) repeated.add(h);
  }
  return repeated;
}

function isBoldFontName(fontRealName: string): boolean {
  return /(?:bold|heavy|black|demi|semibold)/i.test(fontRealName);
}

function isNeutralDarkOrWhiteRgb(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  if (sat < 35) return true; // grayscale / black / white
  if (r < 45 && g < 45 && b < 45) return true;
  if (r > 235 && g > 235 && b > 235) return true;
  return false;
}

/**
 * Inspects option text styling (font weight vs siblings) and page highlight/color signals across
 * an examination PDF so bolded or colored answer choices can be caught offline and subtle visual
 * pages escalate automatically to Gemini PDF Vision.
 */
function analyzePageOptionStyling(
  page: any,
  textContent: any,
  opList: any,
  OPS: any,
  pageQuestions: ParsedExamQuestion[]
): {
  hasHighlightOrCircleGraphics: boolean;
  hasOptionStyleVariance: boolean;
  styledAnswerHints: StyledAnswerHint[];
} {
  // 1. Check operator list for non-template highlight fills or frequent ellipse/curve marks
  let coloredRectCount = 0;
  let lastFillRgb: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.setFillRGBColor && args && args.length >= 3) {
      lastFillRgb = [Number(args[0]) || 0, Number(args[1]) || 0, Number(args[2]) || 0];
    } else if (fn === OPS.fill || fn === OPS.eoFill) {
      if (!isNeutralDarkOrWhiteRgb(lastFillRgb[0], lastFillRgb[1], lastFillRgb[2])) {
        coloredRectCount++;
      }
    }
  }

  // Reconstruct ordered visual lines with font metadata attached
  const rawItems = (textContent?.items || [])
    .filter((it: any) => it && typeof it.str === 'string' && it.str.trim().length > 0 && Array.isArray(it.transform))
    .map((it: any) => {
      const fKey = String(it.fontName || '');
      const fObj = fKey && page.commonObjs?.has?.(fKey) ? page.commonObjs.get(fKey) : null;
      const realFont = String(fObj?.name || fKey);
      return {
        x: Number(it.transform[4]) || 0,
        y: Number(it.transform[5]) || 0,
        str: it.str,
        isBold: isBoldFontName(realFont),
        realFont
      };
    });

  rawItems.sort((a: any, b: any) => (Math.abs(b.y - a.y) > 4.5 ? b.y - a.y : a.x - b.x));

  // Group into line buckets and look for option items "(a) ..." / "a) ..." on this page
  type OptAppearance = { letter: string; text: string; boldChars: number; totalChars: number };
  const qOptGroups: Array<{ items: OptAppearance[] }> = [];
  let curGroup: OptAppearance[] = [];
  const seenInGroup = new Set<string>();

  for (const it of rawItems) {
    const s = it.str.trim();
    const optMatch = s.match(/^\(?([a-eA-E])[\.\)\:]\s*(.*)$/);
    if (optMatch) {
      const letter = optMatch[1].toUpperCase();
      if (letter === 'A' && seenInGroup.size >= 2) {
        qOptGroups.push({ items: curGroup });
        curGroup = [];
        seenInGroup.clear();
      }
      if (!seenInGroup.has(letter)) {
        seenInGroup.add(letter);
        const body = optMatch[2] || '';
        const bodyLen = body.replace(/\s+/g, '').length;
        curGroup.push({
          letter,
          text: body,
          boldChars: it.isBold ? bodyLen : 0,
          totalChars: bodyLen
        });
      }
    } else if (curGroup.length > 0 && !/^\d{1,3}[\.\)]/.test(s)) {
      const last = curGroup[curGroup.length - 1];
      const len = s.replace(/\s+/g, '').length;
      if (len > 0 && last.totalChars < 240) {
        last.text = `${last.text} ${s}`.trim();
        last.totalChars += len;
        if (it.isBold) last.boldChars += len;
      }
    }
  }
  if (curGroup.length >= 2) {
    qOptGroups.push({ items: curGroup });
  }

  let hasOptionStyleVariance = false;
  const styledAnswerHints: StyledAnswerHint[] = [];
  const mcqPageQs = pageQuestions.filter(q => q.options.length >= 2);

  for (let gi = 0; gi < qOptGroups.length; gi++) {
    const grp = qOptGroups[gi].items;
    if (grp.length < 3) continue;

    const richOpts = grp.filter(o => o.totalChars >= 3);
    if (richOpts.length < 3) continue;

    const boldWinners = richOpts.filter(o => o.boldChars / o.totalChars >= 0.7);
    const regularSiblings = richOpts.filter(o => o.boldChars / o.totalChars <= 0.15);

    if (boldWinners.length === 1 && regularSiblings.length === richOpts.length - 1) {
      hasOptionStyleVariance = true;
      const targetQ = mcqPageQs[gi];
      if (
        targetQ &&
        !targetQ.designatedAnswer &&
        targetQ.options.some(o => o.label === boldWinners[0].letter)
      ) {
        styledAnswerHints.push({
          originalNumber: targetQ.originalNumber,
          answer: boldWinners[0].letter,
          signal: 'bold_option'
        });
      }
    }
  }

  return {
    hasHighlightOrCircleGraphics: coloredRectCount > 0,
    hasOptionStyleVariance,
    styledAnswerHints
  };
}

/**
 * Inspects ALL pages of a PDF exam once using pdfjs-dist to gather unique content bitmaps
 * and visual style/highlight cues (bold options, colored rectangles, figures) cleanly.
 */
export async function inspectPdfPagesVisualSignals(
  pdfBuffer: Buffer,
  pages: Array<{ pdfPageIndex: number; text: string }>,
  parsedQuestions: ParsedExamQuestion[]
): Promise<Map<number, PdfPageVisualSignals>> {
  const result = new Map<number, PdfPageVisualSignals>();
  if (pages.length === 0) return result;

  const qByPage = new Map<number, ParsedExamQuestion[]>();
  for (const q of parsedQuestions) {
    const p = q.sourcePageIndex || 1;
    const arr = qByPage.get(p) || [];
    arr.push(q);
    qByPage.set(p, arr);
  }

  let pdfDoc: any = null;
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfDoc = await openPdfForOcr(pdfBuffer);
    const repeatedHashes = await detectRepeatingTemplateHashes(pdfDoc, pages.length);

    for (const p of pages) {
      const pNum = p.pdfPageIndex;
      const page = await pdfDoc.getPage(pNum);
      try {
        const rawPngs = await extractPdfPagePngBuffers(pdfDoc, pNum);
        const contentPngs = rawPngs.filter((buf) => {
          if (buf.length < 3500) return false;
          if (repeatedHashes.has(sha1Hex(buf))) return false;
          return true;
        });

        const pageQs = qByPage.get(pNum) || [];
        const hasMissingKeyOnPage = pageQs.some(q => q.options.length >= 2 && !q.designatedAnswer);

        let styleSignals = {
          hasHighlightOrCircleGraphics: false,
          hasOptionStyleVariance: false,
          styledAnswerHints: [] as StyledAnswerHint[]
        };

        if (hasMissingKeyOnPage) {
          const opList = await page.getOperatorList();
          const tc = await page.getTextContent();
          styleSignals = analyzePageOptionStyling(page, tc, opList, pdfjsLib.OPS, pageQs);
        }

        result.set(pNum, {
          pageNumber: pNum,
          contentPngs,
          hasUniqueContentImages: contentPngs.length > 0,
          hasHighlightOrCircleGraphics: styleSignals.hasHighlightOrCircleGraphics,
          hasOptionStyleVariance: styleSignals.hasOptionStyleVariance,
          styledAnswerHints: styleSignals.styledAnswerHints
        });
      } finally {
        page.cleanup?.();
      }
    }
  } catch (err) {
    console.warn('PDF visual signal inspection warning:', err);
  } finally {
    await pdfDoc?.destroy?.().catch(() => {});
  }

  return result;
}
