// Retrieval relevance measures relatedness, not whether a fact answers a question.
// Automatic replies require a validated grounded answer. Missing AI falls back to review.
export function canSendAutomatically(mode, reply, minimumConfidence, relevance) {
  const threshold = Math.max(0.9, Number(minimumConfidence) || 0.9);
  return mode === 'automatic'
    && reply?.grounded === true
    && reply?.needs_human === false
    && typeof reply?.answer === 'string'
    && reply.answer.trim().length > 0
    && Number.isFinite(Number(reply.confidence))
    && Number(reply.confidence) >= threshold
    && Number(reply.confidence) <= 1
    && Array.isArray(reply.used_fact_ids)
    && reply.used_fact_ids.length > 0
    && Number(relevance) >= 0.015;
}
