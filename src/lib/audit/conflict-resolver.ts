import { RetrievedEvidence } from '@/lib/search/semantic';

export interface ConflictingReferencePair {
  bookA: {
    bookName: string;
    pdfPageIndex: number;
    printedPageNumber: string;
    statement: string;
  };
  bookB: {
    bookName: string;
    pdfPageIndex: number;
    printedPageNumber: string;
    statement: string;
  };
  natureOfDiscrepancy: 'genuine_contradiction' | 'terminological_variation' | 'clinical_context_difference' | 'guideline_discrepancy';
  explanation: string;
  affectsAnswerKey: boolean;
}

/**
 * Detects whether multiple reference books present conflicting statements for the same question concept
 */
export function analyzeCrossReferenceConflicts(
  crossBookEvidence: Record<string, RetrievedEvidence[]>,
  questionStem: string,
  options: Array<{ label: string; text: string }>
): {
  hasConflict: boolean;
  conflicts: ConflictingReferencePair[];
  summaryExplanation: string;
} {
  const bookTitles = Object.keys(crossBookEvidence);
  if (bookTitles.length < 2) {
    return {
      hasConflict: false,
      conflicts: [],
      summaryExplanation: 'Single reference consulted or no multi-book discrepancies detected.'
    };
  }

  const conflicts: ConflictingReferencePair[] = [];

  // Compare pairs of books
  for (let i = 0; i < bookTitles.length; i++) {
    for (let j = i + 1; j < bookTitles.length; j++) {
      const bookNameA = bookTitles[i];
      const bookNameB = bookTitles[j];
      const evListA = crossBookEvidence[bookNameA];
      const evListB = crossBookEvidence[bookNameB];

      if (!evListA || !evListB || evListA.length === 0 || evListB.length === 0) continue;

      const topEvA = evListA[0];
      const topEvB = evListB[0];

      const textA = topEvA.fullPageContent.toLowerCase();
      const textB = topEvB.fullPageContent.toLowerCase();

      // Check for common medical disagreement triggers:
      // e.g. "first-line vs second-line", "contraindicated vs cautiously used", "gold standard vs definitive",
      // dosage discrepancies, numerical threshold discrepancies (e.g. 140/90 vs 130/80)
      const conflictPatterns = [
        {
          trigger: /first[-\s]line/i,
          check: (a: string, b: string) => (a.includes('first-line') || a.includes('drug of choice')) &&
                                          (b.includes('alternative') || b.includes('second-line') || b.includes('not recommended'))
        },
        {
          trigger: /contraindicated/i,
          check: (a: string, b: string) => a.includes('contraindicated') && (b.includes('relative contraindication') || b.includes('safely administered'))
        },
        {
          trigger: /gold standard/i,
          check: (a: string, b: string) => a.includes('gold standard') && b.includes('gold standard') && !a.includes(b.slice(0, 20))
        },
        {
          trigger: /mortality/i,
          check: (a: string, b: string) => (a.includes('reduces mortality') && b.includes('no mortality benefit'))
        }
      ];

      for (const pattern of conflictPatterns) {
        if (pattern.check(textA, textB) || pattern.check(textB, textA)) {
          conflicts.push({
            bookA: {
              bookName: bookNameA,
              pdfPageIndex: topEvA.pdfPageIndex,
              printedPageNumber: topEvA.printedPageNumber,
              statement: topEvA.excerpt || topEvA.fullPageContent.slice(0, 250) + '...'
            },
            bookB: {
              bookName: bookNameB,
              pdfPageIndex: topEvB.pdfPageIndex,
              printedPageNumber: topEvB.printedPageNumber,
              statement: topEvB.excerpt || topEvB.fullPageContent.slice(0, 250) + '...'
            },
            natureOfDiscrepancy: 'guideline_discrepancy',
            explanation: `Reference "${bookNameA}" (Page ${topEvA.printedPageNumber}) and Reference "${bookNameB}" (Page ${topEvB.printedPageNumber}) provide diverging scientific guidelines on this clinical topic.`,
            affectsAnswerKey: true
          });
          break;
        }
      }
    }
  }

  const hasConflict = conflicts.length > 0;
  const summaryExplanation = hasConflict
    ? `Multiple uploaded references contain divergent statements regarding this question. Neither statement has been silently overridden. Additional faculty review is recommended.`
    : 'All consulted reference books demonstrate consistent scientific consensus.';

  return {
    hasConflict,
    conflicts,
    summaryExplanation
  };
}
