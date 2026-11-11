import { getDb } from '@/lib/db';
import { searchReferenceBooks, tokenizeMedicalText, SearchChunk } from './indexer';

export interface RetrievedEvidence {
  referenceBookId: string;
  referenceBookName: string;
  pdfPageIndex: number;
  printedPageNumber: string;
  excerpt: string;
  fullPageContent: string;
  relevanceScore: number;
  targetedOption?: string; // e.g. 'A', 'B', 'stem'
}

export interface QuestionSearchBundle {
  stemEvidence: RetrievedEvidence[];
  optionsEvidence: Record<string, RetrievedEvidence[]>; // Option label -> evidence items
  crossBookEvidence: Record<string, RetrievedEvidence[]>; // Book title -> evidence items
  allRetrievedPages: RetrievedEvidence[];
}

/**
 * Hydrate full extracted page text from document_pages for matched chunks so section headings
 * and surrounding context on the page are preserved intact.
 */
function hydratePages(chunks: SearchChunk[], targetedOption: string): RetrievedEvidence[] {
  if (chunks.length === 0) return [];
  const db = getDb();
  const getPageStmt = db.prepare(`
    SELECT extracted_text, printed_page_number
    FROM document_pages
    WHERE document_id = ? AND pdf_page_index = ?
  `);

  const seen = new Set<string>();
  const results: RetrievedEvidence[] = [];

  for (const chunk of chunks) {
    const key = `${chunk.documentId}:${chunk.pdfPageIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const pageRow = getPageStmt.get(chunk.documentId, chunk.pdfPageIndex) as
      | { extracted_text: string; printed_page_number: string }
      | undefined;

    results.push({
      referenceBookId: chunk.documentId,
      referenceBookName: chunk.documentTitle,
      pdfPageIndex: chunk.pdfPageIndex,
      printedPageNumber: pageRow?.printed_page_number || chunk.printedPageNumber,
      excerpt: chunk.snippet,
      fullPageContent: pageRow?.extracted_text || chunk.content,
      relevanceScore: chunk.score,
      targetedOption
    });
  }

  return results;
}

function buildOptionRelationQuery(text: string): string | null {
  if (/\bdrains?\b/i.test(text)) {
    return text.replace(/\bdrains?(?:\s+in(?:to)?)?\b/gi, 'tributary');
  }
  if (/\btributar(?:y|ies)\b/i.test(text)) {
    return text.replace(/\btributar(?:y|ies)\b/gi, 'drains');
  }
  return null;
}

function expandMedicalAcronymsForQuery(text: string): string {
  const extras: string[] = [];
  if (/\bsuperior\b.{0,24}\bvena\s+cava\b/i.test(text)) extras.push('svc');
  if (/\binferior\b.{0,24}\bvena\s+cava\b/i.test(text)) extras.push('ivc');
  if (/\bheart\s+failure\b/i.test(text)) extras.push('hf');
  if (/\bcardiac\s+output\b/i.test(text)) extras.push('co');
  if (/\bmyocardial\s+infarction\b/i.test(text)) extras.push('mi');
  if (/\bblood\s+pressure\b/i.test(text)) extras.push('bp');
  if (/\bsvc\b/i.test(text)) extras.push('superior vena cava');
  if (/\bivc\b/i.test(text)) extras.push('inferior vena cava');
  return extras.length > 0 ? `${text} ${extras.join(' ')}` : text;
}

/**
 * Retrieve targeted evidence for a complete question and every one of its options
 */
export async function retrieveQuestionEvidence(
  stem: string,
  options: Array<{ label: string; text: string }>,
  selectedBookIds?: string[],
  preferredBookIds?: string[]
): Promise<QuestionSearchBundle> {
  // 1. Search for stem concept using filtered domain tokens (plus expanded acronym forms when applicable)
  const stemTokens = tokenizeMedicalText(stem);
  const stemQuery = stemTokens.join(' ') || stem;
  const acronymExpanded = expandMedicalAcronymsForQuery(stem);

  const primaryStemChunks = searchReferenceBooks(stemQuery, {
    documentIds: selectedBookIds,
    limit: 10
  });
  const acronymStemChunks = acronymExpanded !== stem
    ? searchReferenceBooks(tokenizeMedicalText(acronymExpanded).join(' '), {
        documentIds: selectedBookIds,
        limit: 8
      })
    : [];

  const stemChunksMerged = [...primaryStemChunks, ...acronymStemChunks].sort((a, b) => b.score - a.score);
  const stemEvidence = hydratePages(stemChunksMerged, 'stem').slice(0, 10);

  // 2. Search for each option combined with key stem terms AND standalone definitions (balanced scoring)
  const keyStemNouns = stemTokens.slice(0, 6).join(' ');
  const optionsEvidence: Record<string, RetrievedEvidence[]> = {};

  for (const opt of options) {
    // Search combined (stem + option), relation variant, AND standalone option terms independently
    const combinedChunks = searchReferenceBooks(`${keyStemNouns} ${opt.text}`, {
      documentIds: selectedBookIds,
      limit: 5
    }).map(c => ({ ...c, score: Math.round(c.score * 1.2 * 10) / 10 }));

    const variantQuery = buildOptionRelationQuery(opt.text);
    const variantChunks = variantQuery
      ? searchReferenceBooks(variantQuery, { documentIds: selectedBookIds, limit: 4 }).map(c => ({
          ...c,
          score: Math.round(c.score * 0.85 * 10) / 10
        }))
      : [];

    // Pure option search: strip filler verbs ("drains", "leads", "causes") so defining pages elsewhere (e.g. SVC p.86) rank cleanly
    const pureTokens = tokenizeMedicalText(opt.text).filter(
      t => !['drains', 'drain', 'leads', 'lead', 'causes', 'cause', 'forms', 'form', 'passes', 'pass', 'runs', 'run'].includes(t)
    );
    const pureQuery = pureTokens.length >= 2 ? pureTokens.join(' ') : opt.text;
    const pureEntityChunks = searchReferenceBooks(pureQuery, {
      documentIds: selectedBookIds,
      limit: 3
    }).map(c => ({ ...c, score: Math.round(c.score * 0.55 * 10) / 10 }));

    // Ensure at least the #1 pure entity page is always considered even when combined stem hits dominate
    const combinedHydrated = hydratePages(combinedChunks, opt.label).slice(0, 2);
    const variantHydrated = hydratePages(variantChunks, opt.label).slice(0, 2);
    const pureHydrated = hydratePages(pureEntityChunks, opt.label).slice(0, 2);

    const optSeen = new Set<string>();
    const optPicked: RetrievedEvidence[] = [];
    // Interleave combined match #1, standalone entity match #1 (e.g. p.86 SVC), relation match #1, then secondary hits
    const interleaved = [
      combinedHydrated[0],
      pureHydrated[0],
      variantHydrated[0],
      combinedHydrated[1],
      pureHydrated[1],
      variantHydrated[1]
    ];
    for (const ev of interleaved) {
      if (!ev) continue;
      const k = `${ev.referenceBookId}:${ev.pdfPageIndex}`;
      if (!optSeen.has(k)) {
        optSeen.add(k);
        optPicked.push(ev);
      }
    }
    optionsEvidence[opt.label] = optPicked.slice(0, 5);
  }

  // 3. Aggregate all unique retrieved evidence pages
  const allRetrieved: RetrievedEvidence[] = [...stemEvidence];
  for (const optEvList of Object.values(optionsEvidence)) {
    allRetrieved.push(...optEvList);
  }

  // Apply modest priority boost to subject-matched books while keeping all selected books searchable
  if (preferredBookIds && preferredBookIds.length > 0) {
    const preferredSet = new Set(preferredBookIds);
    for (const ev of allRetrieved) {
      if (preferredSet.has(ev.referenceBookId)) {
        ev.relevanceScore = Math.round(ev.relevanceScore * 1.25 * 10) / 10;
      }
    }
  }

  // Include immediate adjacent pages (-1 and +1) for top 2 highest-scoring pages to preserve multi-page topics & headings
  const sortedSeed = [...allRetrieved].sort((a, b) => b.relevanceScore - a.relevanceScore);
  const db = getDb();
  const adjPageStmt = db.prepare(`
    SELECT pdf_page_index, printed_page_number, extracted_text
    FROM document_pages
    WHERE document_id = ? AND pdf_page_index = ?
  `);

  for (const topEv of sortedSeed.slice(0, 2)) {
    for (const delta of [-1, 1]) {
      const adjIdx = topEv.pdfPageIndex + delta;
      if (adjIdx < 1) continue;
      const adjRow = adjPageStmt.get(topEv.referenceBookId, adjIdx) as any;
      if (adjRow && adjRow.extracted_text && adjRow.extracted_text.trim().length > 25) {
        allRetrieved.push({
          referenceBookId: topEv.referenceBookId,
          referenceBookName: topEv.referenceBookName,
          pdfPageIndex: adjRow.pdf_page_index,
          printedPageNumber: adjRow.printed_page_number || `${adjRow.pdf_page_index}`,
          excerpt: adjRow.extracted_text.slice(0, 220),
          fullPageContent: adjRow.extracted_text,
          relevanceScore: Math.round((topEv.relevanceScore * 0.78) * 10) / 10,
          targetedOption: 'context_continuation'
        });
      }
    }
  }

  // De-duplicate by documentId + pdfPageIndex
  const uniqueMap = new Map<string, RetrievedEvidence>();
  for (const ev of allRetrieved) {
    const key = `${ev.referenceBookId}:${ev.pdfPageIndex}`;
    if (!uniqueMap.has(key) || uniqueMap.get(key)!.relevanceScore < ev.relevanceScore) {
      uniqueMap.set(key, ev);
    }
  }

  const allRetrievedPages = Array.from(uniqueMap.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);

  // 4. Group by reference book to detect multi-book presence
  const crossBookEvidence: Record<string, RetrievedEvidence[]> = {};
  for (const ev of allRetrievedPages) {
    if (!crossBookEvidence[ev.referenceBookName]) {
      crossBookEvidence[ev.referenceBookName] = [];
    }
    crossBookEvidence[ev.referenceBookName].push(ev);
  }

  return {
    stemEvidence,
    optionsEvidence,
    crossBookEvidence,
    allRetrievedPages
  };
}
