import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, PAGES_DIR } from '@/lib/db';
import {
  extractExamQuestionsFromPages,
  extractExamQuestionsFromText,
  hasExamOcrDegradationSignals,
  questionReferencesVisualFigure,
  ParsedExamQuestion
} from './exam-parser';
import { openPdfForOcr, extractPdfPagePngBuffers, performPageOCR } from './ocr';
import {
  extractExamPageWithGeminiVision,
  describeQuestionImageWithVision
} from '@/lib/ai/provider';
import { ExtractedPage } from './parser';

export interface ExamExtractionOutcome {
  questions: ParsedExamQuestion[];
  updatedPageTexts: Map<number, string>;
  usedVisionPages: number[];
  attachedImagesCount: number;
}

type WorkingQuestion = ParsedExamQuestion & {
  _usesVisualFigure?: boolean;
};

function normalizeVisionQuestion(
  q: {
    originalNumber?: number;
    stem?: string;
    options?: Array<{ label?: string; text?: string }>;
    designatedAnswer?: string;
    usesVisualFigure?: boolean;
    visualDescription?: string;
  },
  fallbackIndex: number,
  sourcePageIndex: number
): WorkingQuestion | null {
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
  const visDesc = String(q?.visualDescription || '').trim();

  return {
    questionNumber: fallbackIndex,
    originalNumber: Number.isFinite(origNum) && origNum > 0 ? origNum : fallbackIndex,
    stem,
    options: opts,
    designatedAnswer: ans,
    sourcePageIndex,
    imageDescription: visDesc || undefined,
    _usesVisualFigure: Boolean(q?.usesVisualFigure)
  };
}

function sha1Hex(buf: Buffer): string {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function persistQuestionPng(docTag: string, pageNum: number, imgIdx: number, pngBuf: Buffer, ext: string = '.png'): string {
  if (!fs.existsSync(PAGES_DIR)) {
    fs.mkdirSync(PAGES_DIR, { recursive: true });
  }
  const fileName = `exam-${docTag}-p${pageNum}-img${imgIdx}${ext}`;
  const fullPath = path.join(PAGES_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, pngBuf);
  }
  return fileName;
}

/**
 * Detect hashes of repeated headers/watermarks/footers across multiple sample pages so
 * template branding images are never mistakenly attached to exam questions.
 */
async function detectRepeatingTemplateImageHashes(pdfDoc: any, totalPages: number): Promise<Set<string>> {
  const repeated = new Set<string>();
  if (totalPages < 3) return repeated;

  const hashPageCounts = new Map<string, number>();
  const samplePages = [1, 2, 3, Math.min(totalPages, 5)].filter((v, i, a) => v <= totalPages && a.indexOf(v) === i);

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

/**
 * Unified examination question extractor combining structural Option-Anchor text parsing,
 * automatic Gemini Vision recovery on image-backed/OCR-degraded pages, and figure attachment
 * + visual description enrichment for image-dependent questions.
 */
export async function extractExaminationQuestionsWithVisionFallback(
  pdfBuffer: Buffer,
  pages: Array<Pick<ExtractedPage, 'pdfPageIndex' | 'text' | 'ocrApplied' | 'ocrConfidence' | 'pageType'>>,
  documentId?: string
): Promise<ExamExtractionOutcome> {
  const docTag = (documentId || crypto.randomUUID()).slice(0, 12);
  const fullDocText = pages.map(p => p.text || '').join('\n');
  const textQuestions: WorkingQuestion[] = extractExamQuestionsFromPages(pages);
  const updatedPageTexts = new Map<number, string>();
  const usedVisionPages: number[] = [];

  const db = getDb();
  const providerRow = db.prepare("SELECT value FROM system_settings WHERE key = 'ai_provider'").get() as { value: string } | undefined;
  const keyRow = db.prepare("SELECT value FROM system_settings WHERE key = 'gemini_api_key'").get() as { value: string } | undefined;
  const aiProvider = providerRow?.value || 'built_in';
  const geminiKey = keyRow?.value || process.env.GEMINI_API_KEY;
  const canUseGeminiVision = aiProvider === 'gemini' && Boolean(geminiKey);

  // Identify pages needing Vision OCR recovery AND pages that contain visual-dependent questions
  const hasMissingAnswersOverall = textQuestions.length > 0 && textQuestions.some(q => !q.designatedAnswer);
  const overallSparse = textQuestions.length <= 1 && fullDocText.trim().length > 350;
  const pagesWithVisualTextRefs = new Set<number>(
    textQuestions
      .filter(q => questionReferencesVisualFigure(q.stem, q.options))
      .map(q => q.sourcePageIndex || 1)
  );

  const visionOcrCandidatePageNums = canUseGeminiVision && pages.length <= 25
    ? new Set(
        pages
          .filter((p) => {
            const t = p.text || '';
            if (p.pageType === 'scanned' || p.ocrApplied || p.ocrConfidence < 88) return true;
            if (hasExamOcrDegradationSignals(t)) return true;
            if (overallSparse) return true;
            if (pages.length <= 10 && hasMissingAnswersOverall && t.trim().length > 150) return true;
            return false;
          })
          .slice(0, 15)
          .map(p => p.pdfPageIndex)
      )
    : new Set<number>();

  // Only open PDF.js for image inspection when we actually have Vision OCR candidates or visual-question pages
  const pagesToInspectImages = new Set<number>([...visionOcrCandidatePageNums, ...pagesWithVisualTextRefs]);
  const visionByPage = new Map<number, { questions: WorkingQuestion[]; rawText: string }>();
  const globalAnswerMap = new Map<number, string>();
  const pageContentPngs = new Map<number, Buffer[]>();

  if (pagesToInspectImages.size > 0) {
    let pdfDoc: any = null;
    try {
      pdfDoc = await openPdfForOcr(pdfBuffer);
      const repeatedLogoHashes = await detectRepeatingTemplateImageHashes(pdfDoc, pages.length);

      for (const pageNum of Array.from(pagesToInspectImages).sort((a, b) => a - b)) {
        const rawPngs = await extractPdfPagePngBuffers(pdfDoc, pageNum);
        const contentPngs = rawPngs.filter((buf) => {
          if (buf.length < 12_000 && pages.length >= 2) return false;
          if (repeatedLogoHashes.has(sha1Hex(buf))) return false;
          return buf.length >= 8_000;
        });

        if (contentPngs.length > 0) {
          pageContentPngs.set(pageNum, contentPngs);
        }

        if (visionOcrCandidatePageNums.has(pageNum)) {
          const mainScanPng = contentPngs.find(buf => buf.length > 25_000) || rawPngs.find(buf => buf.length > 25_000);
          if (!mainScanPng) continue;

          const visionRes = await extractExamPageWithGeminiVision(mainScanPng, pageNum, 'image/png');
          if (!visionRes) continue;

          usedVisionPages.push(pageNum);

          if (Array.isArray(visionRes.answerKeyMappings)) {
            for (const m of visionRes.answerKeyMappings) {
              const qn = Number(m?.questionNumber);
              const ans = String(m?.answer || '').trim().toUpperCase().replace(/[^A-E]/g, '');
              if (Number.isFinite(qn) && qn > 0 && ans) {
                globalAnswerMap.set(qn, ans);
              }
            }
          }

          const normQs: WorkingQuestion[] = [];
          for (const rawQ of visionRes.questions || []) {
            const norm = normalizeVisionQuestion(rawQ, normQs.length + 1, pageNum);
            if (norm) {
              normQs.push(norm);
              if (norm.designatedAnswer && norm.originalNumber > 0) {
                globalAnswerMap.set(norm.originalNumber, norm.designatedAnswer);
              }
            }
          }

          const transcribed = String(visionRes.rawTranscribedText || '').trim();
          if (transcribed) {
            updatedPageTexts.set(pageNum, transcribed);
          }

          visionByPage.set(pageNum, {
            questions: normQs,
            rawText: transcribed || ''
          });
        }
      }
    } catch (err) {
      console.warn('Exam Vision/image inspection error (falling back cleanly to structural text):', err);
    } finally {
      await pdfDoc?.destroy?.().catch(() => {});
    }
  }

  // Merge Vision-extracted pages with contiguous non-Vision text runs
  let finalQuestions: WorkingQuestion[] = [];
  if (visionByPage.size > 0) {
    const nonVisionPagesBuffer: Array<Pick<ExtractedPage, 'pdfPageIndex' | 'text'>> = [];

    const flushNonVision = () => {
      if (nonVisionPagesBuffer.length === 0) return;
      const chunkQs = extractExamQuestionsFromPages(nonVisionPagesBuffer);
      nonVisionPagesBuffer.length = 0;
      for (const q of chunkQs) {
        finalQuestions.push({
          ...q,
          questionNumber: finalQuestions.length + 1,
          designatedAnswer: q.designatedAnswer || globalAnswerMap.get(q.originalNumber) || ''
        });
      }
    };

    for (const p of pages) {
      const vis = visionByPage.get(p.pdfPageIndex);
      if (!vis) {
        nonVisionPagesBuffer.push({ pdfPageIndex: p.pdfPageIndex, text: p.text || '' });
        continue;
      }
      flushNonVision();
      for (const q of vis.questions) {
        finalQuestions.push({
          ...q,
          questionNumber: finalQuestions.length + 1,
          designatedAnswer: q.designatedAnswer || globalAnswerMap.get(q.originalNumber) || ''
        });
      }
    }
    flushNonVision();

    if (
      finalQuestions.length === 0 ||
      (finalQuestions.length < textQuestions.length && textQuestions.every(t => t.options.length >= 2))
    ) {
      finalQuestions = textQuestions.map((q) => ({
        ...q,
        designatedAnswer: q.designatedAnswer || globalAnswerMap.get(q.originalNumber) || ''
      }));
    }
  } else {
    finalQuestions = textQuestions;
  }

  // Attach image files & ensure visual descriptions for all image-dependent questions
  let attachedImagesCount = 0;
  let describedBudget = 20;
  const pageVisualIdxCounter = new Map<number, number>();

  for (const q of finalQuestions) {
    const pageNum = q.sourcePageIndex || 1;
    const pngs = pageContentPngs.get(pageNum);
    if (!pngs || pngs.length === 0) continue;

    const needsImage = Boolean(q._usesVisualFigure) || questionReferencesVisualFigure(q.stem, q.options);
    if (!needsImage) continue;

    const usedIdx = pageVisualIdxCounter.get(pageNum) || 0;
    const chosenIdx = Math.min(usedIdx, pngs.length - 1);
    pageVisualIdxCounter.set(pageNum, usedIdx + 1);

    const pngBuf = pngs[chosenIdx];
    const savedName = persistQuestionPng(docTag, pageNum, chosenIdx, pngBuf, '.png');
    q.imagePath = savedName;
    attachedImagesCount++;

    if (!q.imageDescription && canUseGeminiVision && describedBudget > 0) {
      describedBudget--;
      const desc = await describeQuestionImageWithVision(pngBuf, q.stem, q.options, 'image/png');
      if (desc) {
        q.imageDescription = desc;
      }
    }
  }

  const sanitizedQuestions: ParsedExamQuestion[] = finalQuestions.map(({ _usesVisualFigure, ...clean }) => clean);

  return {
    questions: sanitizedQuestions,
    updatedPageTexts,
    usedVisionPages,
    attachedImagesCount
  };
}

/**
 * Parse a directly uploaded exam image file (.png, .jpg, .jpeg, .webp), transcribe every
 * question & answer key, and attach the image to any visually dependent question.
 */
export async function extractExaminationFromDirectImageUpload(
  imageBuffer: Buffer,
  mimeType: string,
  documentId: string
): Promise<ExamExtractionOutcome> {
  const docTag = documentId.slice(0, 12);
  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : mimeType.includes('webp') ? '.webp' : '.png';
  const savedName = persistQuestionPng(docTag, 1, 0, imageBuffer, ext);
  const updatedPageTexts = new Map<number, string>();

  const visionRes = await extractExamPageWithGeminiVision(imageBuffer, 1, mimeType);
  if (visionRes && Array.isArray(visionRes.questions) && visionRes.questions.length > 0) {
    const answerMap = new Map<number, string>();
    for (const m of visionRes.answerKeyMappings || []) {
      const qn = Number(m?.questionNumber);
      const ans = String(m?.answer || '').trim().toUpperCase().replace(/[^A-E]/g, '');
      if (Number.isFinite(qn) && qn > 0 && ans) answerMap.set(qn, ans);
    }

    let attachedCount = 0;
    const questions: ParsedExamQuestion[] = [];
    for (const rawQ of visionRes.questions) {
      const norm = normalizeVisionQuestion(rawQ, questions.length + 1, 1);
      if (!norm) continue;
      const needsImage = Boolean(norm._usesVisualFigure) || questionReferencesVisualFigure(norm.stem, norm.options);
      const designated = norm.designatedAnswer || answerMap.get(norm.originalNumber) || '';
      const imagePath = needsImage ? savedName : undefined;
      if (imagePath) attachedCount++;

      questions.push({
        questionNumber: questions.length + 1,
        originalNumber: norm.originalNumber,
        stem: norm.stem,
        options: norm.options,
        designatedAnswer: designated,
        sourcePageIndex: 1,
        imagePath,
        imageDescription: needsImage ? norm.imageDescription : undefined
      });
    }

    if (visionRes.rawTranscribedText) {
      updatedPageTexts.set(1, visionRes.rawTranscribedText);
    }

    return {
      questions,
      updatedPageTexts,
      usedVisionPages: [1],
      attachedImagesCount: attachedCount
    };
  }

  // Offline / built-in fallback using Tesseract OCR
  const ocrRes = await performPageOCR(imageBuffer, '');
  if (ocrRes.text) {
    updatedPageTexts.set(1, ocrRes.text);
  }
  const fallbackQs = extractExamQuestionsFromText(ocrRes.text || '');
  let attachedCount = 0;
  for (const q of fallbackQs) {
    q.sourcePageIndex = 1;
    if (questionReferencesVisualFigure(q.stem, q.options)) {
      q.imagePath = savedName;
      attachedCount++;
    }
  }

  return {
    questions: fallbackQs,
    updatedPageTexts,
    usedVisionPages: [],
    attachedImagesCount: attachedCount
  };
}

/**
 * Shared persistence helper to replace/insert extracted exam questions (including image paths
 * and visual descriptions) and update examination total_questions cleanly.
 */
export function saveParsedExamQuestions(
  examinationId: string,
  parsedQuestions: ParsedExamQuestion[]
): void {
  const db = getDb();
  db.prepare('DELETE FROM questions WHERE examination_id = ?').run(examinationId);

  const insertQ = db.prepare(`
    INSERT INTO questions (
      id, examination_id, question_number, stem, options_json, designated_answer,
      source_page_index, image_path, image_description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const q of parsedQuestions) {
    insertQ.run(
      crypto.randomUUID(),
      examinationId,
      q.questionNumber,
      q.stem,
      JSON.stringify(q.options),
      q.designatedAnswer || null,
      q.sourcePageIndex || null,
      q.imagePath || null,
      q.imageDescription || null
    );
  }

  db.prepare('UPDATE examinations SET total_questions = ? WHERE id = ?').run(
    parsedQuestions.length,
    examinationId
  );
}
