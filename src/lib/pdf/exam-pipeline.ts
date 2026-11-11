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
import { performPageOCR } from './ocr';
import { inspectPdfPagesVisualSignals, slicePdfPagesToBuffer } from './pdf-visual';
import {
  extractExamPageWithGeminiVision,
  extractExamPdfChunkWithGeminiVision,
  describeQuestionImageWithVision,
  VisionExamPageResult
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

const MAX_VISION_PAGES_PER_EXAM = 24;
const VISION_PDF_CHUNK_SIZE = 3;
const MAX_VISUAL_DESCRIPTIONS_BUDGET = 20;

export function normalizeVisionAnswerLetters(raw?: string): string {
  const cleaned = String(raw || '')
    .toUpperCase()
    .replace(/\b(?:OPTIONS?|ANSWERS?|ANS|KEYS?|CORRECT)\b[:\-]?/g, ' ')
    .replace(/[^A-E,&\s]/g, ' ');
  const tokens = cleaned
    .split(/[,&\s]+/)
    .map(t => t.trim())
    .filter(t => /^[A-E]$/.test(t));
  return Array.from(new Set(tokens)).join(', ');
}

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

  const ans = normalizeVisionAnswerLetters(q?.designatedAnswer);
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

function persistQuestionMediaFile(
  docTag: string,
  fileNameSuffix: string,
  fileBytes: Buffer
): string {
  if (!fs.existsSync(PAGES_DIR)) {
    fs.mkdirSync(PAGES_DIR, { recursive: true });
  }
  const fileName = `exam-${docTag}-${fileNameSuffix}`;
  const fullPath = path.join(PAGES_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, fileBytes);
  }
  return fileName;
}

function ingestVisionChunkResult(
  res: VisionExamPageResult,
  fallbackPageNums: number[],
  visionByPage: Map<number, WorkingQuestion[]>,
  pageAnswerMaps: Map<number, Map<number, string>>,
  appendixAnswerMap: Map<number, string>,
  updatedPageTexts: Map<number, string>
): boolean {
  let foundAnyKey = false;

  for (const m of res.answerKeyMappings || []) {
    const qn = Number(m?.questionNumber);
    const ans = normalizeVisionAnswerLetters(m?.answer);
    if (!Number.isFinite(qn) || qn <= 0 || !ans) continue;
    foundAnyKey = true;

    const pNum = Number(m?.pageNumber);
    const resolvedPage = Number.isFinite(pNum) && fallbackPageNums.includes(pNum) ? pNum : fallbackPageNums[0];
    const pMap = pageAnswerMaps.get(resolvedPage) || new Map<number, string>();
    pMap.set(qn, ans);
    pageAnswerMaps.set(resolvedPage, pMap);

    // If this page has no questions (pure Answer Key appendix page), feed global appendix map
    const qsOnThisPage = (res.questions || []).filter(q => (Number(q?.pageNumber) || resolvedPage) === resolvedPage);
    if (qsOnThisPage.length === 0) {
      appendixAnswerMap.set(qn, ans);
    }
  }

  for (const rawQ of res.questions || []) {
    const pNum = Number(rawQ?.pageNumber);
    const resolvedPage = Number.isFinite(pNum) && fallbackPageNums.includes(pNum) ? pNum : fallbackPageNums[0];
    const list = visionByPage.get(resolvedPage) || [];
    const norm = normalizeVisionQuestion(rawQ, list.length + 1, resolvedPage);
    if (!norm) continue;

    if (norm.designatedAnswer) {
      foundAnyKey = true;
      const pMap = pageAnswerMaps.get(resolvedPage) || new Map<number, string>();
      pMap.set(norm.originalNumber, norm.designatedAnswer);
      pageAnswerMaps.set(resolvedPage, pMap);
    } else {
      const matched = pageAnswerMaps.get(resolvedPage)?.get(norm.originalNumber);
      if (matched) norm.designatedAnswer = matched;
    }

    list.push(norm);
    visionByPage.set(resolvedPage, list);
  }

  const transcribed = String(res.rawTranscribedText || '').trim();
  if (transcribed && fallbackPageNums.length === 1) {
    updatedPageTexts.set(fallbackPageNums[0], transcribed);
  }

  return foundAnyKey;
}

/**
 * Process a list of 1-based page numbers using native PDF chunk Vision (`application/pdf`),
 * falling back to raster PNG page Vision if any chunk call fails.
 */
async function runVisionOnPageBatches(
  pdfBuffer: Buffer,
  pageNums: number[],
  pageContentPngs: Map<number, Buffer[]>,
  visionByPage: Map<number, WorkingQuestion[]>,
  pageAnswerMaps: Map<number, Map<number, string>>,
  appendixAnswerMap: Map<number, string>,
  updatedPageTexts: Map<number, string>,
  usedVisionPages: number[]
): Promise<boolean> {
  let discoveredAnyAnswer = false;
  const sorted = Array.from(new Set(pageNums)).sort((a, b) => a - b);

  for (let i = 0; i < sorted.length; i += VISION_PDF_CHUNK_SIZE) {
    const batch = sorted.slice(i, i + VISION_PDF_CHUNK_SIZE);
    let chunkHandled = false;

    try {
      const chunkPdf = await slicePdfPagesToBuffer(pdfBuffer, batch);
      const chunkRes = await extractExamPdfChunkWithGeminiVision(chunkPdf, batch);
      if (chunkRes) {
        chunkHandled = true;
        batch.forEach(p => { if (!usedVisionPages.includes(p)) usedVisionPages.push(p); });
        if (ingestVisionChunkResult(chunkRes, batch, visionByPage, pageAnswerMaps, appendixAnswerMap, updatedPageTexts)) {
          discoveredAnyAnswer = true;
        }
      }
    } catch (err) {
      console.warn(`PDF chunk Vision failed for pages [${batch.join(', ')}]:`, err);
    }

    if (!chunkHandled) {
      for (const pNum of batch) {
        const pngs = pageContentPngs.get(pNum) || [];
        const mainPng = pngs.find(b => b.length > 25_000) || pngs[0];
        if (!mainPng) continue;

        const pageRes = await extractExamPageWithGeminiVision(mainPng, pNum, 'image/png');
        if (pageRes) {
          if (!usedVisionPages.includes(pNum)) usedVisionPages.push(pNum);
          if (ingestVisionChunkResult(pageRes, [pNum], visionByPage, pageAnswerMaps, appendixAnswerMap, updatedPageTexts)) {
            discoveredAnyAnswer = true;
          }
        }
      }
    }
  }

  return discoveredAnyAnswer;
}

/**
 * Unified examination extractor combining:
 * 1) Deterministic Option-Anchor & page-scoped text/footer/table parser,
 * 2) Deterministic PDF font/highlight style inspection & unique bitmap extraction,
 * 3) Native PDF chunk Gemini Vision fallback (with smart probe guard) for scanned pages,
 *    highlighted/colored/circled answers, missing keys, and embedded or vector figures,
 * 4) Automatic figure attachment (.png raster or 1-page .pdf vector slice) + description.
 */
export async function extractExaminationQuestionsWithVisionFallback(
  pdfBuffer: Buffer,
  pages: Array<Pick<ExtractedPage, 'pdfPageIndex' | 'text' | 'ocrApplied' | 'ocrConfidence' | 'pageType'>>,
  documentId?: string
): Promise<ExamExtractionOutcome> {
  const docTag = (documentId || crypto.randomUUID()).slice(0, 12);
  const textQuestions: WorkingQuestion[] = extractExamQuestionsFromPages(pages);
  const updatedPageTexts = new Map<number, string>();
  const usedVisionPages: number[] = [];

  const db = getDb();
  const providerRow = db.prepare("SELECT value FROM system_settings WHERE key = 'ai_provider'").get() as { value: string } | undefined;
  const keyRow = db.prepare("SELECT value FROM system_settings WHERE key = 'gemini_api_key'").get() as { value: string } | undefined;
  const aiProvider = providerRow?.value || 'built_in';
  const geminiKey = keyRow?.value || process.env.GEMINI_API_KEY;
  const canUseGeminiVision = aiProvider === 'gemini' && Boolean(geminiKey);

  // Inspect all PDF pages once for unique content bitmaps & bold/highlight styling signals
  const visualSignals = await inspectPdfPagesVisualSignals(pdfBuffer, pages, textQuestions);
  const pageContentPngs = new Map<number, Buffer[]>();

  for (const [pNum, sig] of visualSignals.entries()) {
    if (sig.contentPngs.length > 0) {
      pageContentPngs.set(pNum, sig.contentPngs);
    }
    for (const hint of sig.styledAnswerHints) {
      const target = textQuestions.find(
        q => (q.sourcePageIndex || 1) === pNum && q.originalNumber === hint.originalNumber && !q.designatedAnswer
      );
      if (target) {
        target.designatedAnswer = hint.answer;
      }
    }
  }

  // Group text questions by page
  const textByPage = new Map<number, WorkingQuestion[]>();
  for (const q of textQuestions) {
    const pNum = q.sourcePageIndex || 1;
    const arr = textByPage.get(pNum) || [];
    arr.push(q);
    textByPage.set(pNum, arr);
  }

  const visionByPage = new Map<number, WorkingQuestion[]>();
  const pageAnswerMaps = new Map<number, Map<number, string>>();
  const appendixAnswerMap = new Map<number, string>();

  if (canUseGeminiVision && pages.length > 0) {
    const mustInspectPages: number[] = [];
    const unkeyedMcqPages: number[] = [];
    const answerKeyCandidatePages: number[] = [];

    for (const p of pages) {
      const pNum = p.pdfPageIndex;
      const t = p.text || '';
      const sig = visualSignals.get(pNum);
      const pageQs = textByPage.get(pNum) || [];

      const isOcrDegraded =
        p.pageType === 'scanned' ||
        p.ocrApplied ||
        p.ocrConfidence < 90 ||
        hasExamOcrDegradationSignals(t);

      const looksLikeCoverOrToc =
        pNum === 1 && t.trim().length < 220 ||
        /\b(?:table\s+of\s+contents|contents|index|preface|acknowledgements)\b/i.test(t.slice(0, 260));

      const looksLikeAppendix =
        /\b(?:answer\s+keys?|model\s+answers?|solutions?|answers)\b/i.test(t.slice(0, 300));

      const isUnparsedContentPage = t.trim().length > 150 && pageQs.length === 0 && !looksLikeCoverOrToc;
      const hasVisualFigure =
        Boolean(sig?.hasUniqueContentImages) ||
        pageQs.some(q => questionReferencesVisualFigure(q.stem, q.options));
      const hasUnkeyedMcq = pageQs.some(q => q.options.length >= 2 && !q.designatedAnswer);

      if (isOcrDegraded || isUnparsedContentPage || hasVisualFigure) {
        mustInspectPages.push(pNum);
      } else if (looksLikeAppendix) {
        answerKeyCandidatePages.push(pNum);
      } else if (hasUnkeyedMcq) {
        unkeyedMcqPages.push(pNum);
      }
    }

    const totalRemainingBudget = () => Math.max(0, MAX_VISION_PAGES_PER_EXAM - usedVisionPages.length);
    const mustRun = mustInspectPages.slice(0, MAX_VISION_PAGES_PER_EXAM);

    if (mustRun.length > 0) {
      await runVisionOnPageBatches(
        pdfBuffer,
        mustRun,
        pageContentPngs,
        visionByPage,
        pageAnswerMaps,
        appendixAnswerMap,
        updatedPageTexts,
        usedVisionPages
      );
    }

    // Smart probe guard for unkeyed MCQ pages so visual highlights/circled keys across ALL
    // pages get extracted, while truly unkeyed past-exam booklets don't waste 30+ quota calls
    if (unkeyedMcqPages.length > 0 && totalRemainingBudget() > 0) {
      const probePages = [
        ...unkeyedMcqPages.slice(0, 2),
        ...answerKeyCandidatePages.slice(0, 2)
      ].filter((v, idx, a) => !usedVisionPages.includes(v) && a.indexOf(v) === idx);

      if (unkeyedMcqPages.length <= 3) {
        const directPages = [...unkeyedMcqPages, ...answerKeyCandidatePages]
          .filter(p => !usedVisionPages.includes(p))
          .slice(0, totalRemainingBudget());
        if (directPages.length > 0) {
          await runVisionOnPageBatches(
            pdfBuffer,
            directPages,
            pageContentPngs,
            visionByPage,
            pageAnswerMaps,
            appendixAnswerMap,
            updatedPageTexts,
            usedVisionPages
          );
        }
      } else if (probePages.length > 0) {
        const probeFoundKeys = await runVisionOnPageBatches(
          pdfBuffer,
          probePages.slice(0, totalRemainingBudget()),
          pageContentPngs,
          visionByPage,
          pageAnswerMaps,
          appendixAnswerMap,
          updatedPageTexts,
          usedVisionPages
        );

        if (probeFoundKeys && totalRemainingBudget() > 0) {
          const rest = [...unkeyedMcqPages, ...answerKeyCandidatePages]
            .filter(p => !usedVisionPages.includes(p))
            .slice(0, totalRemainingBudget());
          if (rest.length > 0) {
            await runVisionOnPageBatches(
              pdfBuffer,
              rest,
              pageContentPngs,
              visionByPage,
              pageAnswerMaps,
              appendixAnswerMap,
              updatedPageTexts,
              usedVisionPages
            );
          }
        }
      }
    }
  }

  // Merge Vision results non-destructively page by page
  const finalQuestions: WorkingQuestion[] = [];
  for (const p of pages) {
    const pNum = p.pdfPageIndex;
    const textQs = textByPage.get(pNum) || [];
    const visQs = visionByPage.get(pNum);
    const pageAnsMap = pageAnswerMaps.get(pNum);

    const isOcrDegraded =
      p.pageType === 'scanned' ||
      p.ocrApplied ||
      p.ocrConfidence < 90 ||
      hasExamOcrDegradationSignals(p.text || '');

    if (!visQs || visQs.length === 0) {
      for (const q of textQs) {
        const fallbackAns =
          q.designatedAnswer ||
          pageAnsMap?.get(q.originalNumber) ||
          appendixAnswerMap.get(q.originalNumber) ||
          '';
        finalQuestions.push({
          ...q,
          questionNumber: finalQuestions.length + 1,
          designatedAnswer: fallbackAns
        });
      }
      continue;
    }

    const shouldReplacePageWithVision =
      isOcrDegraded ||
      textQs.length <= 1 ||
      visQs.length > textQs.length ||
      (textQs.every(t => t.options.length === 0) && visQs.some(v => v.options.length >= 2));

    if (shouldReplacePageWithVision) {
      for (const v of visQs) {
        const ans =
          v.designatedAnswer ||
          pageAnsMap?.get(v.originalNumber) ||
          appendixAnswerMap.get(v.originalNumber) ||
          '';
        finalQuestions.push({
          ...v,
          questionNumber: finalQuestions.length + 1,
          designatedAnswer: ans
        });
      }
    } else {
      // Enrich cleanly segmented deterministic text questions with visual answers & visual figures
      for (let qi = 0; qi < textQs.length; qi++) {
        const t = { ...textQs[qi] };
        const matchedV =
          visQs.find(v => v.originalNumber === t.originalNumber) ||
          (visQs.length === textQs.length ? visQs[qi] : undefined);

        const resolvedAns =
          t.designatedAnswer ||
          matchedV?.designatedAnswer ||
          pageAnsMap?.get(t.originalNumber) ||
          appendixAnswerMap.get(t.originalNumber) ||
          '';

        t.designatedAnswer = resolvedAns;
        if (matchedV?._usesVisualFigure) {
          t._usesVisualFigure = true;
        }
        if (matchedV?.imageDescription && (!t.imageDescription || matchedV._usesVisualFigure)) {
          t.imageDescription = matchedV.imageDescription;
        }
        t.questionNumber = finalQuestions.length + 1;
        finalQuestions.push(t);
      }
    }
  }

  // Attach raster PNGs or vector 1-page PDF figure snapshots & visual descriptions cleanly
  let attachedImagesCount = 0;
  let describedBudget = MAX_VISUAL_DESCRIPTIONS_BUDGET;
  const pageVisualIdxCounter = new Map<number, number>();
  const savedVectorPageCache = new Map<number, string>();

  const countByPage = new Map<number, number>();
  for (const q of finalQuestions) {
    const p = q.sourcePageIndex || 1;
    countByPage.set(p, (countByPage.get(p) || 0) + 1);
  }

  for (const q of finalQuestions) {
    const pageNum = q.sourcePageIndex || 1;
    const pngs = pageContentPngs.get(pageNum) || [];
    const singleQuestionWithEmbeddedBitmap = pngs.length > 0 && (countByPage.get(pageNum) || 0) === 1;
    const needsFigure =
      Boolean(q._usesVisualFigure) ||
      questionReferencesVisualFigure(q.stem, q.options) ||
      singleQuestionWithEmbeddedBitmap;

    if (!needsFigure) continue;

    if (pngs.length > 0) {
      const usedIdx = pageVisualIdxCounter.get(pageNum) || 0;
      const chosenIdx = Math.min(usedIdx, pngs.length - 1);
      pageVisualIdxCounter.set(pageNum, usedIdx + 1);

      const pngBuf = pngs[chosenIdx];
      q.imagePath = persistQuestionMediaFile(docTag, `p${pageNum}-img${chosenIdx}.png`, pngBuf);
      attachedImagesCount++;

      if (!q.imageDescription && canUseGeminiVision && describedBudget > 0) {
        describedBudget--;
        const desc = await describeQuestionImageWithVision(pngBuf, q.stem, q.options, 'image/png');
        if (desc) q.imageDescription = desc;
      }
    } else {
      // Vector-drawn PDF figure / chart / ECG with no isolated bitmap XObject:
      // save exact crisp 1-page PDF slice for both UI display and Gemini multimodal auditing
      let cachedName = savedVectorPageCache.get(pageNum);
      let sliceBuf: Buffer | null = null;
      if (!cachedName) {
        sliceBuf = await slicePdfPagesToBuffer(pdfBuffer, [pageNum]);
        cachedName = persistQuestionMediaFile(docTag, `p${pageNum}-page.pdf`, sliceBuf);
        savedVectorPageCache.set(pageNum, cachedName);
      }
      q.imagePath = cachedName;
      attachedImagesCount++;

      if (!q.imageDescription && canUseGeminiVision && describedBudget > 0) {
        describedBudget--;
        const bufToDescribe = sliceBuf || (await slicePdfPagesToBuffer(pdfBuffer, [pageNum]));
        const desc = await describeQuestionImageWithVision(bufToDescribe, q.stem, q.options, 'application/pdf');
        if (desc) q.imageDescription = desc;
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
  const savedName = persistQuestionMediaFile(docTag, `p1-img0${ext}`, imageBuffer);
  const updatedPageTexts = new Map<number, string>();

  const visionRes = await extractExamPageWithGeminiVision(imageBuffer, 1, mimeType);
  if (visionRes && Array.isArray(visionRes.questions) && visionRes.questions.length > 0) {
    const answerMap = new Map<number, string>();
    for (const m of visionRes.answerKeyMappings || []) {
      const qn = Number(m?.questionNumber);
      const ans = normalizeVisionAnswerLetters(m?.answer);
      if (Number.isFinite(qn) && qn > 0 && ans) answerMap.set(qn, ans);
    }

    let attachedCount = 0;
    const questions: ParsedExamQuestion[] = [];
    for (const rawQ of visionRes.questions) {
      const norm = normalizeVisionQuestion(rawQ, questions.length + 1, 1);
      if (!norm) continue;

      const hasRichVisualDesc = Boolean(norm.imageDescription && norm.imageDescription.trim().length > 18);
      const needsImage =
        Boolean(norm._usesVisualFigure) ||
        questionReferencesVisualFigure(norm.stem, norm.options) ||
        (hasRichVisualDesc && visionRes.questions.length <= 2);

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
    if (questionReferencesVisualFigure(q.stem, q.options) || fallbackQs.length === 1) {
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
