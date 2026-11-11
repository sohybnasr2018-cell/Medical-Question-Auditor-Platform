/**
 * Shared utility for detecting inverted-polarity (EXCEPT / NOT / FALSE / LEAST) questions.
 * Kept in one shared module so AI prompts, deterministic fallback, and response sanitizers
 * apply identical polarity rules without duplicating heuristics.
 */

const INVERTED_POLARITY_PATTERNS: RegExp[] = [
  // Classic "All of the following ... EXCEPT" or trailing "EXCEPT:"
  /\bexcept\b/i,

  // "All of the following are NOT / false / incorrect ..."
  /\ball\s+(?:of\s+)?the\s+followings?\b.*\b(?:not|incorrect|false|wrong|untrue|least)\b/i,

  // Negative interrogative stems ("Which of the following is NOT...", "Regarding X, which does not...")
  /^(?:which|all|the|regarding|concerning|about)\b.{0,140}\b(?:is|are|was|were|does|do|did|can|could|should|will|would|has|have|had)(?:\s+not|n't)\b/i,
  /\b(?:isn't|aren't|doesn't|don't|didn't|can't|couldn't|shouldn't|wouldn't|won't|cannot)\b/i,

  // "Which (of the following) ... is false / incorrect / wrong"
  /\b(?:which|all)\b.{0,140}\b(?:is|are)\s+(?:not|incorrect|false|wrong|untrue|inaccurate)\b/i,

  // "statement(s) about/regarding X is false / incorrect / wrong / not true"
  /\b(?:statement|option|item|feature|finding|sentence|choice|fact)s?(?:\s+(?:about|regarding|concerning|of)\b.{0,80})?\s+(?:is|are|which\s+is|that\s+is)\s+(?:not|incorrect|false|wrong|untrue|inaccurate)\b/i,

  // Imperative "choose/select the incorrect/false/wrong"
  /\b(?:choose|select|pick|identify|find|mark)\s+(?:the\s+)?(?:false|incorrect|wrong|untrue|inaccurate|exception)\b/i,

  // Noun-phrase forms: "the false statement", "false regarding", "incorrect statement"
  // (Carefully avoids clinical terms like "false aneurysm", "false positive", "false lumen")
  /\bthe\s+(?:false|incorrect|wrong|untrue|inaccurate|least\s+accurate)\s+(?:statement|option|answer|choice|fact|feature)\b/i,
  /\b(?:false|incorrect|wrong|untrue)\s+(?:statement|option|regarding|about)\b/i,
  /\bregarding\b.{0,80}\bis\s+(?:false|incorrect|wrong|untrue|inaccurate)\b/i,

  // Elliptical "Which one of following side effects not related to..." (missing auxiliary "is/are")
  /\b(?:which\s+(?:one\s+)?(?:of\s+(?:the\s+)?following\b.{0,60}))\bnot\s+(?:related|associated|true|correct|caused|present|found|used|indicated)\b/i,

  // "least likely / least common / least accurate"
  /\bleast\s+(?:likely|common|frequent|accurate|characteristic)\b/i,
];

/**
 * Determine whether an examination question asks the student to select the FALSE / excluded
 * option (e.g., EXCEPT, NOT, incorrect statement, least likely) rather than a true statement.
 */
export function isInvertedPolarityQuestion(stem: string): boolean {
  if (!stem) return false;
  const normalized = stem.replace(/\s+/g, ' ').trim();
  return INVERTED_POLARITY_PATTERNS.some(rx => rx.test(normalized));
}
