export const policies = [
  {
    id: 'RET-01',
    title: 'Returns & refunds',
    section: '30-day return window',
    body: 'Delivered items may be returned within 30 calendar days of delivery. Refund requests are recorded for the original purchase amount in USD. Refund processing takes 5–7 business days after the returned item is received and inspected. Shipping charges are not refunded. Personalized items are final sale unless defective.',
    tags: ['return', 'refund', '退货', '退款', '30 days'],
  },
  {
    id: 'EXC-02',
    title: 'Defective item exchange',
    section: 'Replacements at no extra cost',
    body: 'Defective or damaged items, including personalized items, qualify for an exchange within 30 calendar days of delivery. A replacement must be in stock. The original item must be returned using the prepaid label. Standard replacement dispatch takes 2–3 business days; delivery dates are estimates and cannot be guaranteed.',
    tags: ['exchange', 'broken', 'defective', 'damaged', '换货', '坏', '声音', 'replacement'],
  },
  {
    id: 'SHP-03',
    title: 'Shipping & delivery',
    section: 'Tracking and delivery estimates',
    body: 'In-transit orders cannot be returned or exchanged until delivered. Standard shipping is 3–5 business days. If an order is late or missing, escalate to a support specialist. Never promise an exact delivery date or offer unconfigured expedited shipping.',
    tags: ['shipping', 'tracking', 'late', 'delivery', '物流', '快递', '发货'],
  },
  {
    id: 'ESC-04',
    title: 'Specialist escalation',
    section: 'When a person should take over',
    body: 'Escalate out-of-window requests, unavailable replacements, disputed charges, safety concerns, and cases requiring exceptions. Include the customer request, relevant order, policy findings, and next steps. Do not override policies or invent refunds. Support tickets in this demo stay in the application; no external team is contacted.',
    tags: ['human', 'agent', 'escalate', 'exception', '人工', '投诉', 'missing'],
  },
];
const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) || [];
/** Small-corpus lexical RAG: TF-IDF cosine similarity, with exact bilingual tags. */
export function retrieve(query: string) {
  const corpus = policies.map((p) =>
    tokens(`${p.title} ${p.section} ${p.body} ${p.tags.join(' ')}`),
  );
  const q = tokens(query),
    vocab = new Set(corpus.flat().concat(q));
  const idf = (t: string) =>
    Math.log((corpus.length + 1) / (corpus.filter((d) => d.includes(t)).length + 1)) + 1;
  const vector = (doc: string[]) =>
    new Map(
      [...vocab].map((t) => [
        t,
        (doc.filter((x) => x === t).length / Math.max(doc.length, 1)) * idf(t),
      ]),
    );
  const qv = vector(q);
  const norm = (v: Map<string, number>) =>
    Math.sqrt([...v.values()].reduce((a, b) => a + b * b, 0));
  return policies
    .map((p, i) => {
      const v = vector(corpus[i]);
      const cosine =
        [...vocab].reduce((sum, t) => sum + (v.get(t) || 0) * (qv.get(t) || 0), 0) /
        (norm(v) * norm(qv) || 1);
      return {
        ...p,
        score: cosine + p.tags.filter((t) => query.toLowerCase().includes(t)).length * 0.15,
      };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
export function eligible(
  order: Record<string, any>,
  action: 'exchange' | 'refund',
  reason: string,
  now = Date.now(),
) {
  if (order.status !== 'delivered')
    return {
      allowed: false,
      code: 'NOT_DELIVERED',
      message: 'This order is not eligible: it must be delivered and have no existing resolution.',
    };
  if (!order.delivered_at || now - new Date(order.delivered_at).getTime() > 30 * 86400000)
    return {
      allowed: false,
      code: 'OUTSIDE_WINDOW',
      message: 'This order is outside the 30-day window. A specialist can review your request.',
    };
  const defective =
    /defect|broken|damag|fault|no sound|not work|stopped work|坏|损|故障|声音/i.test(reason);
  if (action === 'exchange' && !defective)
    return {
      allowed: false,
      code: 'REASON_REQUIRED',
      message: 'Please describe the defect or damage before requesting an exchange.',
    };
  if (order.category === 'personalized' && !defective)
    return {
      allowed: false,
      code: 'FINAL_SALE',
      message: 'Personalized items are final sale unless defective.',
    };
  return {
    allowed: true,
    code: 'ELIGIBLE',
    message:
      action === 'exchange'
        ? 'Eligible for a no-cost replacement, subject to available stock.'
        : 'Eligible for a return and refund request. Refund follows receipt and inspection.',
  };
}
