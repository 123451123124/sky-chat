export function needsQueryPlanning(messages: Array<{ role: string; content: string }>): boolean {
  const question = messages.at(-1)?.content || '';
  if (question.length > 500 || (question.match(/[?？]/g)?.length || 0) > 1) return true;
  if (/对比|比较|分别|相差|区别|各自|异同|\b(compare|versus|vs|difference|both|each|between)\b/i.test(question)) return true;
  const hasHistory = messages.filter((m) => m.role === 'user').length > 1;
  return hasHistory && /它|他们|她们|这|那|上述|之前|刚才|上面|前面|继续|再|还有|第二|另一|\b(it|they|them|those|these|that|previous)\b/i.test(question);
}
