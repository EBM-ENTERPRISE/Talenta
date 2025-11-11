import { evaluateConstraints, ConstraintResult } from '@/lib/csp';
import { makeJobConstraints, type SearchConstraints, type RawJobItem } from '@/lib/constraints';

export interface CspEval {
  ok: boolean;
  violated: string[];
  satisfied: string[];
  score: number; // 0..100 (componente agregada)
  mandatoryScore: number; // 0..1 (restrições obrigatórias)
  optionalScore: number; // 0..1 (restrições desejáveis)
  details: ConstraintResult[];
}

export interface FilterOutcome {
  items: RawJobItem[];
  evaluations: CspEval[];
}

export function filterByConstraints(items: RawJobItem[], constraints?: SearchConstraints | null): FilterOutcome {
  if (!constraints) {
    return {
      items,
      evaluations: items.map(() => ({
        ok: true,
        violated: [],
        satisfied: [],
        score: 100,
        mandatoryScore: 1,
        optionalScore: 0,
        details: [],
      })),
    };
  }

  const cons = makeJobConstraints(constraints);
  if (cons.length === 0) {
    return {
      items,
      evaluations: items.map(() => ({
        ok: true,
        violated: [],
        satisfied: [],
        score: 100,
        mandatoryScore: 1,
        optionalScore: 0,
        details: [],
      })),
    };
  }

  const evals: CspEval[] = [];
  const kept: RawJobItem[] = [];

  for (const item of items) {
    const res = evaluateConstraints(cons, item);
    const violated = res.filter((r) => !r.ok).map((r) => r.label);
    const satisfied = res.filter((r) => r.ok).map((r) => r.label);
    const totalMandatory = res.filter((r) => r.mandatory).length;
    const satisfiedMandatory = res.filter((r) => r.mandatory && r.ok).length;
    const totalOptional = res.filter((r) => !r.mandatory).length;
    const satisfiedOptional = res.filter((r) => !r.mandatory && r.ok).length;

    const mandatoryScore = totalMandatory > 0 ? satisfiedMandatory / totalMandatory : 1;
    const optionalScore = totalOptional > 0 ? satisfiedOptional / totalOptional : 0;
    // Score agregado: obrigatórias têm peso dominante
    const score = Math.round((mandatoryScore * 0.8 + optionalScore * 0.2) * 100);
    const ok = totalMandatory === 0 ? true : (satisfiedMandatory === totalMandatory);
    const ev: CspEval = { ok, violated, satisfied, score, mandatoryScore, optionalScore, details: res };
    evals.push(ev);
    // Keep all results; UI can show satisfaction/violations without hiding data
    kept.push(item);
  }

  return { items: kept, evaluations: evals };
}

export type { SearchConstraints, RawJobItem };