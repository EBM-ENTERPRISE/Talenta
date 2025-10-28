import { evaluateConstraints, ConstraintResult } from '@/lib/csp';
import { makeJobConstraints, type SearchConstraints, type RawJobItem } from '@/lib/constraints';

export interface CspEval {
  ok: boolean;
  violated: string[];
  satisfied: string[];
  score: number; // 0..100
  details: ConstraintResult[];
}

export interface FilterOutcome {
  items: RawJobItem[];
  evaluations: CspEval[];
}

export function filterByConstraints(items: RawJobItem[], constraints?: SearchConstraints | null): FilterOutcome {
  if (!constraints) {
    return { items, evaluations: items.map(() => ({ ok: true, violated: [], satisfied: [], score: 100, details: [] })) };
  }

  const cons = makeJobConstraints(constraints);
  if (cons.length === 0) {
    return { items, evaluations: items.map(() => ({ ok: true, violated: [], satisfied: [], score: 100, details: [] })) };
  }

  const evals: CspEval[] = [];
  const kept: RawJobItem[] = [];

  for (const item of items) {
    const res = evaluateConstraints(cons, item);
    const violated = res.filter((r) => !r.ok).map((r) => r.label);
    const satisfied = res.filter((r) => r.ok).map((r) => r.label);
    const score = Math.round((satisfied.length / res.length) * 100);
    const ok = violated.length === 0;
    const ev: CspEval = { ok, violated, satisfied, score, details: res };
    evals.push(ev);
    // Keep all results; UI can show satisfaction/violations without hiding data
    kept.push(item);
  }

  return { items: kept, evaluations: evals };
}

export type { SearchConstraints, RawJobItem };