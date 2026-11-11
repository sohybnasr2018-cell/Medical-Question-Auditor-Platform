import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createWorker } from 'tesseract.js';

// Medical suffixes and common anatomical/pharmacological roots to verify OCR accuracy
const MEDICAL_ROOTS = [
  'itis', 'ectomy', 'emia', 'ology', 'pathy', 'plasia', 'trophy', 'scopy',
  'stomy', 'plasty', 'lysis', 'kinesia', 'phagia', 'uria', 'pnea', 'cardia',
  'myo', 'card', 'neuro', 'nephro', 'hepato', 'gastro', 'osteo', 'chole',
  'arteri', 'ven', 'pulmo', 'bronch', 'angio', 'leuko', 'erythro', 'thromb',
  'receptor', 'agonist', 'antagonist', 'inhibition', 'enzyme', 'syndrome',
  'pathology', 'histology', 'physiology', 'pharmacology', 'anatomy'
];

export interface OCRResult {
  text: string;
  confidence: number;
  wordCount: number;
  flaggedTerms: string[];
  isMedicalContent: boolean;
}

/**
 * Validates medical terms extracted by OCR to detect possible garbled characters
 */
export function auditMedicalVocabulary(text: string): {
  confidenceDelta: number;
  flaggedTerms: string[];
  medicalTermCount: number;
} {
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  let medicalTermCount = 0;
  const flaggedTerms: string[] = [];

  for (const word of words) {
    // Check if word has medical root
    const hasMedicalRoot = MEDICAL_ROOTS.some(root => word.includes(root));
    if (hasMedicalRoot) {
      medicalTermCount++;
    }

    // Check for OCR glitches like numbers mixed in words e.g. "my0card1um" or strange sequences
    if (/[a-z]+[0-9]+[a-z]+/i.test(word) || /(.)\1{3,}/.test(word)) {
      flaggedTerms.push(word);
    }
  }

  // If there are strange artifacts, decrease confidence slightly
  const penalty = Math.min(flaggedTerms.length * 3, 25);
  const bonus = Math.min(medicalTermCount * 1.5, 15);

  return {
    confidenceDelta: bonus - penalty,
    flaggedTerms: Array.from(new Set(flaggedTerms)).slice(0, 10),
    medicalTermCount
  };
}

let workerPromise: Promise<any> | null = null;

async function createConfiguredTesseractWorker() {
  const cwdPath = process['cwd']();
  const localTrainedData = [cwdPath, 'eng.traineddata'].join(path.sep);
  const tmpDir = Reflect.apply(os.tmpdir, os, []);
  const tmpTrainedData = [tmpDir, 'eng.traineddata'].join(path.sep);

  // On serverless platforms (e.g. Vercel), cwd is read-only; seed eng.traineddata into writable tmpdir once
  if (fs.existsSync(localTrainedData) && !fs.existsSync(tmpTrainedData)) {
    try {
      fs.copyFileSync(localTrainedData, tmpTrainedData);
    } catch {
      // ignore if another concurrent invocation already wrote it
    }
  }

  return createWorker('eng', 1, {
    cachePath: tmpDir,
    ...(fs.existsSync(localTrainedData) ? { langPath: cwdPath, gzip: false } : {})
  });
}

async function getTesseractWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        const worker = await createConfiguredTesseractWorker();
        return worker;
      } catch (err) {
        console.warn('Tesseract worker initialization fallback:', err);
        return null;
      }
    })();
  }
  return workerPromise;
}

/**
 * Runs OCR on an image buffer or base64 representation of a scanned page
 */
export async function performPageOCR(
  imageBufferOrBase64: Buffer | string,
  existingText: string = ''
): Promise<OCRResult> {
  try {
    const worker = await getTesseractWorker();

    if (!worker) {
      // Fallback if Tesseract WASM is not available in environment
      const cleanExisting = existingText.trim();
      const vocabCheck = auditMedicalVocabulary(cleanExisting);
      return {
        text: cleanExisting || '[Scanned page - OCR worker unavailable]',
        confidence: cleanExisting.length > 50 ? 80 : 45,
        wordCount: cleanExisting.split(/\s+/).filter(Boolean).length,
        flaggedTerms: vocabCheck.flaggedTerms,
        isMedicalContent: vocabCheck.medicalTermCount > 0
      };
    }

    const { data } = await worker.recognize(imageBufferOrBase64);
    const ocrText = reconstructOcrLayoutText(data) || (data.text || '').trim();
    const rawConfidence = typeof data.confidence === 'number' ? data.confidence : 75;

    const vocabCheck = auditMedicalVocabulary(ocrText);
    const adjustedConfidence = Math.max(
      10,
      Math.min(99, Math.round(rawConfidence + vocabCheck.confidenceDelta))
    );

    return {
      text: ocrText.trim(),
      confidence: adjustedConfidence,
      wordCount: ocrText.split(/\s+/).filter(Boolean).length,
      flaggedTerms: vocabCheck.flaggedTerms,
      isMedicalContent: vocabCheck.medicalTermCount > 0
    };
  } catch (error: any) {
    console.error('OCR processing error:', error);
    return {
      text: existingText || '',
      confidence: 30,
      wordCount: existingText.split(/\s+/).filter(Boolean).length,
      flaggedTerms: ['OCR_PROCESSING_FAILED'],
      isMedicalContent: false
    };
  }
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function pngCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, payload: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, payload])), 0);
  return Buffer.concat([len, typeBuf, payload, crcBuf]);
}

/**
 * Pure-Node PNG encoder converting PDF.js raw pixel buffers (1bpp/8bpp gray, RGB24, RGBA32)
 * into valid PNG buffers for Tesseract OCR without native canvas dependencies.
 */
export function encodeRawImageToPng(
  width: number,
  height: number,
  data: Uint8Array | Uint8ClampedArray,
  kind: number = 2
): Buffer {
  const stride = width * 3;
  const rawRows = Buffer.alloc((stride + 1) * height);
  const pixelCount = width * height;

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawRows[rowStart] = 0; // PNG filter type: None
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const dst = rowStart + 1 + x * 3;
      if (kind === 2) {
        const src = idx * 3;
        rawRows[dst] = data[src] ?? 255;
        rawRows[dst + 1] = data[src + 1] ?? 255;
        rawRows[dst + 2] = data[src + 2] ?? 255;
      } else if (kind === 3) {
        const src = idx * 4;
        const a = data[src + 3] ?? 255;
        if (a >= 255) {
          rawRows[dst] = data[src] ?? 255;
          rawRows[dst + 1] = data[src + 1] ?? 255;
          rawRows[dst + 2] = data[src + 2] ?? 255;
        } else {
          const invA = 255 - a;
          rawRows[dst] = ((data[src] ?? 255) * a + 255 * invA) >> 8;
          rawRows[dst + 1] = ((data[src + 1] ?? 255) * a + 255 * invA) >> 8;
          rawRows[dst + 2] = ((data[src + 2] ?? 255) * a + 255 * invA) >> 8;
        }
      } else {
        // 8-bit grayscale or 1bpp bitmask
        let val = 255;
        if (data.length >= pixelCount) {
          val = data[idx] ?? 255;
        } else {
          const byteIdx = idx >> 3;
          const bit = 7 - (idx & 7);
          val = ((data[byteIdx] ?? 0) >> bit) & 1 ? 255 : 0;
        }
        rawRows[dst] = val;
        rawRows[dst + 1] = val;
        rawRows[dst + 2] = val;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 2; // RGB color type
  const idat = zlib.deflateSync(rawRows, { level: 3 });

  return Buffer.concat([
    PNG_SIGNATURE,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0))
  ]);
}

async function resolvePdfObjWithTimeout(pool: any, name: string, timeoutMs: number = 3000): Promise<any> {
  if (!pool || typeof pool.get !== 'function') return null;
  if (typeof pool.has === 'function' && !pool.has(name)) return null;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    try {
      pool.get(name, (obj: any) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(obj);
        }
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

/**
 * Loads a PDF.js document once for multi-page raster extraction during OCR.
 */
export async function openPdfForOcr(pdfBuffer: Buffer): Promise<any> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dataCopy = new Uint8Array(pdfBuffer);
  return pdfjsLib.getDocument({
    data: dataCopy,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0
  }).promise;
}

/**
 * Extracts significant embedded raster images from a specific PDF page as PNG Buffers.
 */
export async function extractPdfPagePngBuffers(pdfDoc: any, pageNum: number): Promise<Buffer[]> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const page = await pdfDoc.getPage(pageNum);
  try {
    const opList = await page.getOperatorList();
    const candidates: Array<{ order: number; pixels: number; imgObj: any }> = [];
    const seenNames = new Set<string>();

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const arg = opList.argsArray[i]?.[0];

      if (fn === pdfjsLib.OPS.paintImageXObject && typeof arg === 'string') {
        if (seenNames.has(arg)) continue;
        seenNames.add(arg);
        let imgObj = await resolvePdfObjWithTimeout(page.objs, arg);
        if (!imgObj && page.commonObjs) {
          imgObj = await resolvePdfObjWithTimeout(page.commonObjs, arg);
        }
        if (imgObj?.data && imgObj.width >= 80 && imgObj.height >= 80) {
          const pixels = imgObj.width * imgObj.height;
          if (pixels <= 25_000_000) {
            candidates.push({ order: candidates.length, pixels, imgObj });
          }
        }
      } else if (fn === pdfjsLib.OPS.paintInlineImageXObject && arg?.data && arg.width >= 80 && arg.height >= 80) {
        const pixels = arg.width * arg.height;
        if (pixels <= 25_000_000) {
          candidates.push({ order: candidates.length, pixels, imgObj: arg });
        }
      }
    }

    // Keep up to top 6 largest images, then restore original stream order so horizontal page strips stay top-to-bottom
    const selected = candidates.length > 6
      ? [...candidates].sort((a, b) => b.pixels - a.pixels).slice(0, 6).sort((a, b) => a.order - b.order)
      : candidates;
    const pngs: Buffer[] = [];
    for (const { imgObj } of selected) {
      try {
        pngs.push(encodeRawImageToPng(imgObj.width, imgObj.height, imgObj.data, imgObj.kind || 2));
      } catch (encodeErr) {
        console.warn(`PNG encode skipped on page ${pageNum}:`, encodeErr);
      }
    }
    return pngs;
  } finally {
    try {
      page.cleanup?.();
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Reconstructs column-aware reading order from Tesseract word bounding boxes so
 * two-column medical slides/tables keep left-column items separate from right-column items.
 */
export function reconstructOcrLayoutText(data: any): string {
  const words = (data?.words || []).filter((w: any) => {
    const t = w?.text?.trim() || '';
    if (!t || (w.confidence ?? 0) <= 15 || !w.bbox) return false;
    if (/^[|\[\]]{1,3}$/.test(t) && (w.confidence ?? 0) < 85) return false;
    return true;
  });
  if (words.length === 0) return (data?.text || '').trim();

  const heights = words.map((w: any) => Math.max(8, w.bbox.y1 - w.bbox.y0)).sort((a: number, b: number) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 18;
  const maxX = Math.max(...words.map((w: any) => w.bbox.x1));
  const minX = Math.min(...words.map((w: any) => w.bbox.x0));
  const pageSpan = Math.max(100, maxX - minX);
  const colGapThreshold = Math.max(medianH * 1.8, pageSpan * 0.032);

  const sortedY = [...words].sort((a: any, b: any) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
  const rows: any[][] = [];
  for (const w of sortedY) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    const lastRow = rows[rows.length - 1];
    if (!lastRow) {
      rows.push([w]);
    } else {
      const avgCy = lastRow.reduce((s, x) => s + (x.bbox.y0 + x.bbox.y1) / 2, 0) / lastRow.length;
      if (Math.abs(cy - avgCy) <= medianH * 0.65) {
        lastRow.push(w);
      } else {
        rows.push([w]);
      }
    }
  }

  type Seg = { x0: number; x1: number; text: string };
  const rowSegs: Seg[][] = rows.map(row => {
    row.sort((a: any, b: any) => a.bbox.x0 - b.bbox.x0);
    const segs: Seg[] = [];
    let curWords: any[] = [row[0]];
    for (let i = 1; i < row.length; i++) {
      const prev = curWords[curWords.length - 1];
      if (row[i].bbox.x0 - prev.bbox.x1 > colGapThreshold) {
        segs.push({
          x0: curWords[0].bbox.x0,
          x1: prev.bbox.x1,
          text: curWords.map(w => w.text.trim()).join(' ')
        });
        curWords = [row[i]];
      } else {
        curWords.push(row[i]);
      }
    }
    const last = curWords[curWords.length - 1];
    segs.push({
      x0: curWords[0].bbox.x0,
      x1: last.bbox.x1,
      text: curWords.map(w => w.text.trim()).join(' ')
    });
    return segs;
  });

  const outLines: string[] = [];
  const midX = minX + pageSpan * 0.48;
  let i = 0;
  while (i < rowSegs.length) {
    if (rowSegs[i].length >= 2) {
      const colLeft: string[] = [];
      const colRight: string[] = [];
      let j = i;
      while (j < rowSegs.length && rowSegs[j].length >= 2) {
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
    outLines.push(rowSegs[i].map(s => s.text).join('  '));
    i++;
  }

  return outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function recognizeBufferWithWorker(
  worker: any,
  pngBuffer: Buffer,
  fallbackText: string
): Promise<OCRResult> {
  const { data } = await worker.recognize(pngBuffer);
  const rawText = reconstructOcrLayoutText(data) || (data.text || '').trim();
  const baseConf = typeof data.confidence === 'number' ? data.confidence : 60;
  const vocabAudit = auditMedicalVocabulary(rawText);
  const adjustedConf = Math.max(0, Math.min(100, Math.round(baseConf + vocabAudit.confidenceDelta)));

  return {
    text: rawText || fallbackText,
    confidence: adjustedConf,
    wordCount: rawText.split(/\s+/).filter(Boolean).length,
    flaggedTerms: vocabAudit.flaggedTerms,
    isMedicalContent: vocabAudit.medicalTermCount > 0 || rawText.length > 50
  };
}

/**
 * Extracts raster images from a specific PDF page and runs OCR using Tesseract.js,
 * cleanly merging any existing native selectable text with the OCR text.
 */
export async function performPdfPageOCR(
  pdfDocOrBuffer: any,
  pageNum: number,
  existingText: string = '',
  customWorker?: any
): Promise<OCRResult> {
  const cleanedNative = existingText.trim();
  const nativeWordCount = cleanedNative.split(/\s+/).filter(Boolean).length;

  let ownsDoc = false;
  let pdfDoc = pdfDocOrBuffer;
  try {
    if (Buffer.isBuffer(pdfDocOrBuffer) || pdfDocOrBuffer instanceof Uint8Array) {
      pdfDoc = await openPdfForOcr(Buffer.from(pdfDocOrBuffer));
      ownsDoc = true;
    }

    const pngBuffers = await extractPdfPagePngBuffers(pdfDoc, pageNum);
    if (pngBuffers.length === 0) {
      return {
        text: cleanedNative,
        confidence: cleanedNative.length > 0 ? 75 : 35,
        wordCount: nativeWordCount,
        flaggedTerms: cleanedNative.length > 0 ? [] : ['NO_RASTER_IMAGES_ON_PAGE'],
        isMedicalContent: cleanedNative.length > 50
      };
    }

    const worker = customWorker || (await getTesseractWorker());
    if (!worker) {
      return {
        text: cleanedNative,
        confidence: 40,
        wordCount: nativeWordCount,
        flaggedTerms: ['OCR_WORKER_UNAVAILABLE'],
        isMedicalContent: false
      };
    }

    const ocrParts: string[] = [];
    const flaggedSet = new Set<string>();
    let confSum = 0;
    let isMedical = false;

    for (const png of pngBuffers) {
      const res = await recognizeBufferWithWorker(worker, png, '');
      if (res.text.trim()) {
        ocrParts.push(res.text.trim());
        confSum += res.confidence;
        res.flaggedTerms.forEach(t => flaggedSet.add(t));
        if (res.isMedicalContent) isMedical = true;
      }
    }

    const combinedOcr = ocrParts.join('\n').trim();
    let finalText = combinedOcr;
    if (cleanedNative && combinedOcr) {
      finalText = combinedOcr.toLowerCase().includes(cleanedNative.toLowerCase().slice(0, 40))
        ? combinedOcr
        : `${cleanedNative}\n${combinedOcr}`;
    } else if (!combinedOcr) {
      finalText = cleanedNative;
    }

    const avgConf = ocrParts.length > 0 ? Math.round(confSum / ocrParts.length) : 35;
    return {
      text: finalText,
      confidence: avgConf,
      wordCount: finalText.split(/\s+/).filter(Boolean).length,
      flaggedTerms: Array.from(flaggedSet).slice(0, 10),
      isMedicalContent: isMedical || nativeWordCount > 20
    };
  } catch (err) {
    console.error(`PDF Page ${pageNum} OCR failed:`, err);
    return {
      text: cleanedNative,
      confidence: 30,
      wordCount: nativeWordCount,
      flaggedTerms: ['OCR_PROCESSING_FAILED'],
      isMedicalContent: false
    };
  } finally {
    if (ownsDoc && pdfDoc?.destroy) {
      await pdfDoc.destroy().catch(() => {});
    }
  }
}

/**
 * Runs pooled parallel OCR over multiple scanned pages of a PDF document cleanly.
 */
export async function ocrPdfScannedPages(
  pdfBuffer: Buffer,
  pages: Array<{ pageNumber: number; existingText: string }>,
  concurrency: number = 2,
  onProgress?: (completed: number, total: number, pageNumber: number) => void
): Promise<Map<number, OCRResult>> {
  const results = new Map<number, OCRResult>();
  if (pages.length === 0) return results;

  const pdfDoc = await openPdfForOcr(pdfBuffer);
  const workerCount = Math.min(Math.max(1, concurrency), pages.length, 3);
  const workers: any[] = [];

  try {
    for (let i = 0; i < workerCount; i++) {
      workers.push(await createConfiguredTesseractWorker());
    }

    let cursor = 0;
    let completed = 0;

    const runWorker = async (worker: any) => {
      while (cursor < pages.length) {
        const idx = cursor++;
        const item = pages[idx];
        const res = await performPdfPageOCR(pdfDoc, item.pageNumber, item.existingText, worker);
        results.set(item.pageNumber, res);
        completed++;
        onProgress?.(completed, pages.length, item.pageNumber);
      }
    };

    await Promise.all(workers.map(w => runWorker(w)));
    return results;
  } finally {
    await Promise.all(workers.map(w => w?.terminate?.().catch(() => {})));
    await pdfDoc?.destroy?.().catch(() => {});
  }
}
