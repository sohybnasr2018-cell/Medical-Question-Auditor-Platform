import pdfParse from 'pdf-parse';

export interface ExtractedPage {
  pdfPageIndex: number; // 1-based index
  printedPageNumber: string;
  text: string;
  hasNativeText: boolean;
  ocrApplied: boolean;
  ocrConfidence: number;
  pageType: 'digital' | 'scanned' | 'mixed';
  wordCount: number;
  charCount: number;
  flaggedUncertain: boolean;
}

export interface PDFParseResult {
  pageCount: number;
  title: string;
  pages: ExtractedPage[];
  avgConfidence: number;
}

/**
 * Reconstruct visual reading order (top-to-bottom Y, left-to-right X) from PDF text items.
 * Fixes scrambled object-creation order common in Canva, InDesign, and multi-column PDFs.
 */
function reconstructVisualPageText(items: any[]): string {
  const clean = (items || [])
    .filter((it: any) => it && typeof it.str === 'string' && it.str.trim().length > 0 && Array.isArray(it.transform))
    .map((it: any) => ({
      x: Number(it.transform[4]) || 0,
      y: Number(it.transform[5]) || 0,
      w: Number(it.width) || 0,
      str: it.str
    }));

  if (clean.length === 0) return '';

  // Sort top-to-bottom (higher Y first), then left-to-right (lower X first)
  clean.sort((a, b) => (Math.abs(b.y - a.y) > 4.5 ? b.y - a.y : a.x - b.x));

  const lines: Array<{ y: number; items: typeof clean }> = [];
  let curLine: { y: number; items: typeof clean } | null = null;

  for (const it of clean) {
    if (!curLine || Math.abs(curLine.y - it.y) > 4.5) {
      curLine = { y: it.y, items: [it] };
      lines.push(curLine);
    } else {
      curLine.items.push(it);
    }
  }

  const minX = Math.min(...clean.map(it => it.x));
  const maxX = Math.max(...clean.map(it => it.x + it.w));
  const pageSpan = Math.max(200, maxX - minX);
  const colGapThreshold = Math.max(28, pageSpan * 0.055);
  const midX = minX + pageSpan * 0.48;

  type Seg = { x0: number; x1: number; text: string };
  const rowSegs: Seg[][] = lines.map((line) => {
    line.items.sort((a, b) => a.x - b.x);
    const segs: Seg[] = [];
    let curText = '';
    let segStart = 0;
    let prevEnd: number | null = null;

    for (const it of line.items) {
      const s = it.str.trim();
      if (!s) continue;
      if (prevEnd === null) {
        segStart = it.x;
        curText = s;
      } else {
        const gap = it.x - prevEnd;
        if (gap > colGapThreshold) {
          segs.push({ x0: segStart, x1: prevEnd, text: curText.trim() });
          segStart = it.x;
          curText = s;
        } else {
          curText += ' ' + s;
        }
      }
      prevEnd = it.x + it.w;
    }
    if (curText.trim()) {
      segs.push({ x0: segStart, x1: prevEnd ?? segStart, text: curText.trim() });
    }
    return segs;
  }).filter(segs => segs.length > 0);

  const isShortMcqOrKeyRow = (segs: Seg[]): boolean => {
    const allShort = segs.every(s => s.text.length < 18);
    if (allShort) return true;
    const hasOptionMarkers = segs.filter(s => /^[a-eA-E][\.\)]\s/.test(s.text)).length >= 2;
    const hasKeyPairs = segs.every(s => /^\d{1,3}[\s\.\-\):]+[a-eA-E]\b/i.test(s.text));
    return hasOptionMarkers || hasKeyPairs;
  };

  // De-interleave multi-row 2-column textbook/comparison regions so left column stays grouped above right column
  const outLines: string[] = [];
  let i = 0;
  while (i < rowSegs.length) {
    if (rowSegs[i].length >= 2 && !isShortMcqOrKeyRow(rowSegs[i])) {
      const colLeft: string[] = [];
      const colRight: string[] = [];
      let j = i;
      while (j < rowSegs.length && rowSegs[j].length >= 2 && !isShortMcqOrKeyRow(rowSegs[j])) {
        const leftParts = rowSegs[j].filter(s => (s.x0 + s.x1) / 2 < midX).map(s => s.text);
        const rightParts = rowSegs[j].filter(s => (s.x0 + s.x1) / 2 >= midX).map(s => s.text);
        if (leftParts.length) colLeft.push(leftParts.join(' '));
        if (rightParts.length) colRight.push(rightParts.join(' '));
        j++;
      }
      if (colLeft.length >= 2 && colRight.length >= 2) {
        outLines.push(...colLeft, '', ...colRight, '');
        i = j;
        continue;
      }
    }
    outLines.push(rowSegs[i].map(s => s.text).join('    '));
    i++;
  }

  return outLines
    .filter((line, idx, arr) => line !== '' || (idx > 0 && arr[idx - 1] !== ''))
    .join('\n')
    .trim();
}

/**
 * Heuristic to detect printed page numbers in page headers or footers
 */
function extractPrintedPageNumber(pageText: string, defaultPage: number): string {
  const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return `${defaultPage}`;

  const candidates = [
    lines[0],
    lines[1],
    lines[lines.length - 1],
    lines[lines.length - 2]
  ].filter(Boolean);

  for (const line of candidates) {
    const match = line.match(/^(?:page|p\.?)?\s*(\d{1,5})(?:\s*of\s*\d+)?$/i) ||
                  line.match(/^(\d{1,5})\s+(?:Exam Models|Question Bank)/i) ||
                  line.match(/\|\s*CVS Module\s*(\d{1,5})$/i) ||
                  line.match(/(\d{1,5})$/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (num > 0 && num < 5000) {
        return `${num}`;
      }
    }
  }

  return `${defaultPage}`;
}

/**
 * Classifies page content density and nature
 */
function evaluatePageText(text: string): {
  pageType: 'digital' | 'scanned' | 'mixed';
  hasNativeText: boolean;
  wordCount: number;
  charCount: number;
} {
  const clean = text.trim();
  const charCount = clean.length;
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  if (charCount < 30 || wordCount < 6) {
    return {
      pageType: 'scanned',
      hasNativeText: false,
      wordCount,
      charCount
    };
  }

  const alphaChars = clean.replace(/[^a-zA-Z0-9]/g, '').length;
  const alphaRatio = alphaChars / (charCount || 1);

  if (alphaRatio < 0.4 && wordCount < 30) {
    return {
      pageType: 'mixed',
      hasNativeText: true,
      wordCount,
      charCount
    };
  }

  return {
    pageType: 'digital',
    hasNativeText: true,
    wordCount,
    charCount
  };
}

/**
 * Parse complete PDF buffer into individual pages with metadata using coordinate-aware visual sorting.
 */
export async function parsePdfDocument(
  pdfBuffer: Buffer,
  documentTitle: string,
  onProgress?: (stage: string, progress: number) => void
): Promise<PDFParseResult> {
  onProgress?.('Extracting native PDF text with visual layout reconstruction', 20);

  // Primary engine: modern pdfjs-dist with 2D (Y, X) visual layout ordering
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      verbosity: 0
    });
    const pdf = await loadingTask.promise;
    const pages: ExtractedPage[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const pageText = reconstructVisualPageText(tc.items);
      const evaluation = evaluatePageText(pageText);
      const printedPage = extractPrintedPageNumber(pageText, i);

      pages.push({
        pdfPageIndex: i,
        printedPageNumber: printedPage,
        text: pageText,
        hasNativeText: evaluation.hasNativeText,
        ocrApplied: false,
        ocrConfidence: evaluation.hasNativeText ? 98.5 : 0,
        pageType: evaluation.pageType,
        wordCount: evaluation.wordCount,
        charCount: evaluation.charCount,
        flaggedUncertain: evaluation.pageType === 'scanned'
      });
    }

    const totalConfidence = pages.reduce((sum, p) => sum + p.ocrConfidence, 0);
    const avgConfidence = pages.length > 0 ? totalConfidence / pages.length : 0;
    onProgress?.('Text extraction completed', 50);

    return {
      pageCount: pdf.numPages,
      title: documentTitle || 'Medical Document',
      pages,
      avgConfidence: Math.round(avgConfidence * 10) / 10
    };
  } catch (pdfjsErr) {
    console.warn('pdfjs-dist extraction fallback to pdf-parse:', pdfjsErr);
  }

  // Fallback engine: pdf-parse with visual sorting inside pagerender
  const pages: ExtractedPage[] = [];
  let pageIndexCounter = 0;

  const options = {
    pagerender: (pageData: any) => {
      pageIndexCounter++;
      const currentIdx = pageIndexCounter;

      return pageData.getTextContent().then((textContent: any) => {
        const pageText = reconstructVisualPageText(textContent.items);
        const evaluation = evaluatePageText(pageText);
        const printedPage = extractPrintedPageNumber(pageText, currentIdx);

        pages.push({
          pdfPageIndex: currentIdx,
          printedPageNumber: printedPage,
          text: pageText,
          hasNativeText: evaluation.hasNativeText,
          ocrApplied: false,
          ocrConfidence: evaluation.hasNativeText ? 98.5 : 0,
          pageType: evaluation.pageType,
          wordCount: evaluation.wordCount,
          charCount: evaluation.charCount,
          flaggedUncertain: evaluation.pageType === 'scanned'
        });

        return pageText;
      });
    }
  };

  try {
    const data = await pdfParse(pdfBuffer, options);
    const pageCount = data.numpages || pages.length;
    pages.sort((a, b) => a.pdfPageIndex - b.pdfPageIndex);

    const totalConfidence = pages.reduce((sum, p) => sum + p.ocrConfidence, 0);
    const avgConfidence = pages.length > 0 ? totalConfidence / pages.length : 0;

    onProgress?.('Text extraction completed', 50);

    return {
      pageCount,
      title: documentTitle || (data.info?.Title ? String(data.info.Title) : 'Medical Document'),
      pages,
      avgConfidence: Math.round(avgConfidence * 10) / 10
    };
  } catch (error: any) {
    console.error('PDF parsing error:', error);
    throw new Error(`Failed to parse PDF document: ${error.message}`);
  }
}
