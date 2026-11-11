import { getDb } from '@/lib/db';
import crypto from 'node:crypto';

export interface SearchChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  pageId: string;
  pdfPageIndex: number;
  printedPageNumber: string;
  content: string;
  score: number;
  snippet: string;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'their',
  'have', 'has', 'had', 'are', 'was', 'were', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'not', 'but', 'into', 'than', 'then', 'when', 'where',
  'what', 'which', 'who', 'why', 'how', 'all', 'any', 'both', 'each', 'more',
  'most', 'other', 'some', 'such', 'only', 'also', 'very', 'about', 'between',
  'regarding', 'following', 'statement', 'statements', 'accurate', 'correct',
  'incorrect', 'true', 'false', 'wrong', 'except', 'choose', 'select', 'best',
  'likely', 'patient', 'patients', 'history', 'condition', 'present', 'presents',
  'associated', 'characterized', 'clinical', 'finding', 'findings', 'approach',
  'treatment', 'therapy', 'drug', 'drugs', 'agent', 'mechanism', 'action',
  'effect', 'effects', 'related', 'known', 'called', 'primary', 'common',
  'described', 'describes', 'usually', 'during', 'within', 'after', 'before',
  'over', 'under', 'does', 'did', 'not', 'you', 'your'
]);

const MEDICAL_PREFIXES = ['anti', 'hypo', 'hyper', 'poly', 'mono', 'auto', 'endo', 'peri', 'para', 'intra', 'extra'];

const SHORT_CLINICAL_TOKENS = new Set([
  't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9',
  'l1', 'l2', 'l3', 'l4', 'l5', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7',
  's1', 's2', 's3', 's4', 'o2', 'co', 'hr', 'bp', 'hf', 'iv', 'av', 'sa',
  'rv', 'lv', 'ra', 'la', 'mv', 'tv', 'ph', 'mi', 'lt', 'rt'
]);

/**
 * Tokenize and normalize medical text for BM25 and semantic matching
 */
export function tokenizeMedicalText(text: string): string[] {
  // Collapse dotted initialisms (e.g. "I.V.C." -> "ivc", "S.V.C." -> "svc", "C.O." -> "co")
  const normalized = text
    .toLowerCase()
    .replace(/\b([a-z])\.([a-z])\.(?:([a-z])\.)?(?:([a-z])\.)?/g, '$1$2$3$4')
    .replace(/\bbranchs\b/g, 'branches');

  const all = normalized
    .replace(/[^\w\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(token => token.length >= 3 || SHORT_CLINICAL_TOKENS.has(token) || /^[tcls]\d{1,2}$/.test(token));

  const filtered = all.filter(token => !STOPWORDS.has(token));
  return filtered.length > 0 ? filtered : all;
}

/**
 * Escape special regex characters
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Index a document's pages into chunked searchable records
 */
export function indexDocumentPages(documentId: string): void {
  const db = getDb();

  // Clean existing chunks for this document
  db.prepare("DELETE FROM document_chunks WHERE document_id = ?").run(documentId);

  const pages = db.prepare(`
    SELECT id, pdf_page_index, printed_page_number, extracted_text
    FROM document_pages
    WHERE document_id = ?
    ORDER BY pdf_page_index ASC
  `).all(documentId) as Array<{
    id: string;
    pdf_page_index: number;
    printed_page_number: string;
    extracted_text: string;
  }>;

  const insertChunk = db.prepare(`
    INSERT INTO document_chunks (
      id, document_id, page_id, pdf_page_index, printed_page_number, chunk_index, content, tokens_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const page of pages) {
    if (!page.extracted_text || page.extracted_text.trim().length === 0) continue;

    const paragraphs = page.extracted_text
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length >= 12);

    // If text has no paragraphs, chunk by word count (preserving even short summary/bullet slides >= 2 words)
    const chunks: string[] = [];
    if (paragraphs.length <= 1) {
      const words = page.extracted_text.split(/\s+/).filter(Boolean);
      const chunkSize = 180;
      const overlap = 30;
      for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
        const chunkWords = words.slice(i, i + chunkSize);
        if (chunkWords.length >= 2) {
          chunks.push(chunkWords.join(' '));
        }
      }
    } else {
      chunks.push(...paragraphs);
    }

    chunks.forEach((chunkContent, idx) => {
      const chunkId = crypto.randomUUID();
      const tokens = tokenizeMedicalText(chunkContent);
      insertChunk.run(
        chunkId,
        documentId,
        page.id,
        page.pdf_page_index,
        page.printed_page_number || `${page.pdf_page_index}`,
        idx,
        chunkContent,
        tokens.length
      );
    });
  }
}

/**
 * Search indexed reference books using BM25-like scoring, root/prefix matching, and phrase matching
 */
export function searchReferenceBooks(
  query: string,
  options?: {
    documentIds?: string[];
    limit?: number;
    minScore?: number;
  }
): SearchChunk[] {
  const db = getDb();
  const limit = options?.limit || 12;
  const targetDocIds = options?.documentIds || [];

  const queryTokens = Array.from(new Set(tokenizeMedicalText(query)));
  if (queryTokens.length === 0) return [];

  let docFilter = '';
  const params: any[] = [];
  if (targetDocIds.length > 0) {
    const placeholders = targetDocIds.map(() => '?').join(',');
    docFilter = `AND c.document_id IN (${placeholders})`;
    params.push(...targetDocIds);
  }

  const sql = `
    SELECT 
      c.id,
      c.document_id,
      d.title as document_title,
      c.page_id,
      c.pdf_page_index,
      c.printed_page_number,
      c.content
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.status = 'ready' ${docFilter}
  `;

  const candidates = db.prepare(sql).all(...params) as Array<{
    id: string;
    document_id: string;
    document_title: string;
    page_id: string;
    pdf_page_index: number;
    printed_page_number: string;
    content: string;
  }>;

  const scoredResults: SearchChunk[] = [];
  const normalizedQuery = query.toLowerCase();

  for (const candidate of candidates) {
    const contentLower = candidate.content.toLowerCase();
    let score = 0;

    // Exact phrase match bonus
    if (normalizedQuery.length > 8 && contentLower.includes(normalizedQuery)) {
      score += 50;
    }

    let matchedTokenCount = 0;
    let firstHitPos = -1;

    for (const token of queryTokens) {
      const esc = escapeRegExp(token);
      const exactCount = (contentLower.match(new RegExp(`\\b${esc}\\b`, 'g')) || []).length;

      if (exactCount > 0) {
        matchedTokenCount++;
        const tokenWeight = token.length >= 9 ? 6.5 : token.length >= 6 ? 4.0 : 2.5;
        score += (1 + Math.log(exactCount)) * tokenWeight;
        if (firstHitPos < 0) firstHitPos = contentLower.indexOf(token);
        continue;
      }

      // Morphological prefix/stem match (e.g. "gout" -> "gouty", "seizures" -> "seizure", "inhibits" -> "inhibitor", "anastomoses" -> "anastomosis")
      if (token.length >= 4) {
        const stem = token.length >= 7 ? token.slice(0, token.length - 3) : token.slice(0, Math.max(4, token.length - 1));
        if (stem.length >= 4 && new RegExp(`\\b${escapeRegExp(stem)}`, 'i').test(contentLower)) {
          matchedTokenCount += 0.85;
          score += token.length >= 9 ? 4.5 : 2.2;
          if (firstHitPos < 0) firstHitPos = contentLower.indexOf(stem);
          continue;
        }

        // Prefix-stripped core root match (e.g. "hypolipidemic" -> "lipidemic" matches "antihyperlipidemic")
        const matchedPrefix = MEDICAL_PREFIXES.find(p => token.startsWith(p) && token.length - p.length >= 5);
        if (matchedPrefix) {
          const core = token.slice(matchedPrefix.length, token.length - 1);
          if (core.length >= 4 && contentLower.includes(core)) {
            matchedTokenCount += 0.75;
            score += 2.0;
            if (firstHitPos < 0) firstHitPos = contentLower.indexOf(core);
          }
        }
      }
    }

    const coverageRatio = matchedTokenCount / (queryTokens.length || 1);
    score *= (1 + coverageRatio * 2.5);

    if (score >= (options?.minScore ?? 1.2)) {
      const idx = Math.max(0, firstHitPos);
      const start = Math.max(0, idx - 60);
      const end = Math.min(candidate.content.length, idx + 220);
      const snippet = (start > 0 ? '...' : '') + candidate.content.slice(start, end).trim() + (end < candidate.content.length ? '...' : '');

      scoredResults.push({
        id: candidate.id,
        documentId: candidate.document_id,
        documentTitle: candidate.document_title,
        pageId: candidate.page_id,
        pdfPageIndex: candidate.pdf_page_index,
        printedPageNumber: candidate.printed_page_number,
        content: candidate.content,
        score: Math.round(score * 10) / 10,
        snippet
      });
    }
  }

  scoredResults.sort((a, b) => b.score - a.score);
  return scoredResults.slice(0, limit);
}
