import { getDb } from '@/lib/db';
import {
  extractExamQuestionsFromText,
  hasExamOcrDegradationSignals,
  ParsedExamQuestion
} from './exam-parser';
import { openPdfForOcr, extractPdfPagePngBuffers } from './ocr';
import { extractExamPageWithGeminiVision } from '@/lib/ai/provider';
import { ExtractedPage } from './parser';

export interface ExamExtractionOutcome {
  questions: ParsedExamQuestion[];
  updatedPageTexts: Map<number, string>;
  usedVisionPages: number[];
}

function normalizeVisionQuestion(
  q: { originalNumber?: number; stem?: string; options?: Array<{ label?: string; text?: string }>; designatedAnswer?: string },
  fallbackIndex: number
): ParsedExamQuestion | null {
  const stem = String(q?.stem || '').replace(/\s+/g, ' ').trim();
  if (stem.length < 6) return null;

  const opts = Array.isArray(q?.options)
    ? q.options
        .map(o => ({
          label: String(o?.label || '').trim().replace(/[^a-eA-E]/g, '').toUpperCase().slice(0, 1),
          text: String(o?.text || '').replace(/\s+/g, ' ').trim()
        }))
        .filter(o => Boolean(o.label) && Boolean(o.text))
    : [];

  opts.sort((a, b) => a.label.localeCompare(b.label));

  const ans = String(q?.designatedAnswer || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-E,]/g, '');

  const origNum = Number(q?.originalNumber);
  return {
    questionNumber: fallbackIndex,
    originalNumber: Number.isFinite(origNum) && origNum > 0 ? origNum : fallbackIndex,
    stem,
    options: opts,
    designatedAnswer: ans
  };
}

/**
 * Unified examination question extractor combining structural Option-Anchor text parsing
 * with automatic Gemini Vision recovery on image-backed or OCR-degraded exam pages.
 */
export async function extractExaminationQuestionsWithVisionFallback(
  pdfBuffer: Buffer,
  pages: Array<Pick<ExtractedPage, 'pdfPageIndex' | 'text' | 'ocrApplied' | 'ocrConfidence' | 'pageType'>>
): Promise<ExamExtractionOutcome> {
  const fullDocText = pages.map(p => p.text || '').join('\n');
  const textQuestions = extractExamQuestionsFromText(fullDocText);
  const updatedPageTexts = new Map<number, string>();
  const usedVisionPages: number[] = [];

  const db = getDb();
  const providerRow = db.prepare("SELECT value FROM system_settings WHERE key = 'ai_provider'").get() as { value: string } | undefined;
  const keyRow = db.prepare("SELECT value FROM system_settings WHERE key = 'gemini_api_key'").get() as { value: string } | undefined;
  const aiProvider = providerRow?.value || 'built_in';
  const geminiKey = keyRow?.value || process.env.GEMINI_API_KEY;

  if (aiProvider !== 'gemini' || !geminiKey || pages.length === 0 || pages.length > 25) {
    return { questions: textQuestions, updatedPageTexts, usedVisionPages };
  }

  // Decide which pages warrant checking for embedded scan images and running Vision recovery
  const hasMissingAnswersOverall = textQuestions.length > 0 && textQuestions.some(q => !q.designatedAnswer);
  const overallSparse = textQuestions.length <= 1 && fullDocText.trim().length > 350;
  const candidatePages = pages.filter((p) => {
    const t = p.text || '';
    if (p.pageType === 'scanned' || p.ocrApplied || p.ocrConfidence < 88) return true;
    if (hasExamOcrDegradationSignals(t)) return true;
    if (overallSparse) return true;
    if (pages.length <= 10 && hasMissingAnswersOverall && t.trim().length > 150) return true;
    return false;
  }).slice(0, 15);

  if (candidatePages.length === 0) {
    return { questions: textQuestions, updatedPageTexts, usedVisionPages };
  }

  let pdfDoc: any = null;
  const visionByPage = new Map<number, { questions: ParsedExamQuestion[]; rawText: string }>();
  const globalAnswerMap = new Map<number, string>();

  try {
    pdfDoc = await openPdfForOcr(pdfBuffer);

    for (const p of candidatePages) {
      const pngs = await extractPdfPagePngBuffers(pdfDoc, p.pdfPageIndex);
      // Only run Vision when the page actually contains a large raster scan image (never waste calls on pure digital text PDFs)
      const mainScanPng = pngs.find(buf => buf.length > 25_000);
      if (!mainScanPng) continue;

      const visionRes = await extractExamPageWithGeminiVision(mainScanPng, p.pdfPageIndex);
      if (!visionRes) continue;

      usedVisionPages.push(p.pdfPageIndex);

      if (Array.isArray(visionRes.answerKeyMappings)) {
        for (const m of visionRes.answerKeyMappings) {
          const qn = Number(m?.questionNumber);
          const ans = String(m?.answer || '').trim().toUpperCase().replace(/[^A-E]/g, '');
          if (Number.isFinite(qn) && qn > 0 && ans) {
            globalAnswerMap.set(qn, ans);
          }
        }
      }

      const normQs: ParsedExamQuestion[] = [];
      for (const rawQ of visionRes.questions || []) {
        const norm = normalizeVisionQuestion(rawQ, normQs.length + 1);
        if (norm) {
          normQs.push(norm);
          if (norm.designatedAnswer && norm.originalNumber > 0) {
            globalAnswerMap.set(norm.originalNumber, norm.designatedAnswer);
          }
        }
      }

      const transcribed = String(visionRes.rawTranscribedText || '').trim();
      if (transcribed) {
        updatedPageTexts.set(p.pdfPageIndex, transcribed);
      }

      visionByPage.set(p.pdfPageIndex, {
        questions: normQs,
        rawText: transcribed || p.text || ''
      });
    }
  } catch (err) {
    console.warn('Vision-assisted exam recovery error (continuing with structural parser):', err);
  } finally {
    await pdfDoc?.destroy?.().catch(() => {});
  }

  if (visionByPage.size === 0) {
    return { questions: textQuestions, updatedPageTexts, usedVisionPages };
  }

  // Build final question list combining Vision-extracted pages with contiguous non-Vision text runs
  const combinedQuestions: ParsedExamQuestion[] = [];
  let nonVisionTextBuffer: string[] = [];

  const flushNonVisionText = () => {
    if (nonVisionTextBuffer.length === 0) return;
    const chunkQs = extractExamQuestionsFromText(nonVisionTextBuffer.join('\n'));
    nonVisionTextBuffer = [];
    for (const q of chunkQs) {
      combinedQuestions.push({
        questionNumber: combinedQuestions.length + 1,
        originalNumber: q.originalNumber,
        stem: q.stem,
        options: q.options,
        designatedAnswer: q.designatedAnswer || globalAnswerMap.get(q.originalNumber) || ''
      });
    }
  };

  for (const p of pages) {
    const vis = visionByPage.get(p.pdfPageIndex);
    if (!vis) {
      nonVisionTextBuffer.push(p.text || '');
      continue;
    }

    flushNonVisionText();
    for (const q of vis.questions) {
      combinedQuestions.push({
        questionNumber: combinedQuestions.length + 1,
        originalNumber: q.originalNumber,
        stem: q.stem,
        options: q.options,
        designatedAnswer: q.designatedAnswer || globalAnswerMap.get(q.originalNumber) || ''
      });
    }
  }
  flushNonVisionText();

  if (combinedQuestions.length === 0 || (combinedQuestions.length < textQuestions.length && textQuestions.every(t => t.options.length >= 2))) {
    const mergedTextQs = textQuestions.map((q) => ({
      ...q,
      designatedAnswer: q.designatedAnswer || globalAnswerMap.get(q.originalNumber) || ''
    }));
    return { questions: mergedTextQs, updatedPageTexts, usedVisionPages };
  }

  return {
    questions: combinedQuestions,
    updatedPageTexts,
    usedVisionPages
  };
}
