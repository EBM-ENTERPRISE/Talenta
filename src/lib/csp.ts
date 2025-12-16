export type ConstraintContext = Record<string, unknown>;

export interface Constraint<TContext extends ConstraintContext = ConstraintContext> {
  id: string;
  label: string;
  check: (ctx: TContext) => boolean;
  // true = obrigatória, false = desejável/opcional
  mandatory?: boolean;
}

export interface ConstraintResult {
  id: string;
  label: string;
  ok: boolean;
  mandatory: boolean;
}

/**
 * Evaluate a set of constraints against a context (typically one result item).
 */
export function evaluateConstraints<TContext extends ConstraintContext>(
  constraints: Constraint<TContext>[],
  ctx: TContext,
): ConstraintResult[] {
  return constraints.map((c) => ({ id: c.id, label: c.label, ok: safeCheck(c, ctx), mandatory: c.mandatory ?? true }));
}

function safeCheck<TContext extends ConstraintContext>(c: Constraint<TContext>, ctx: TContext): boolean {
  try {
    return !!c.check(ctx);
  } catch (e) {
    console.warn('[CSP] constraint check error', { id: c.id, label: c.label, error: e });
    return false;
  }
}

/**
 * Simple backtracking solver (generic), useful for future extensions.
 * Currently unused in UI; kept for completeness.
 */
export type Variable<T = unknown> = { name: string; domain: T[] };
export type Assignment = Record<string, unknown>;

export function solve(
  variables: Variable[],
  constraints: Constraint<Assignment>[],
): Assignment[] {
  const solutions: Assignment[] = [];

  function backtrack(i: number, current: Assignment) {
    if (i >= variables.length) {
      if (checkMandatory(current, constraints)) solutions.push({ ...current });
      return;
    }
    const v = variables[i];
    for (const val of v.domain) {
      const next: Assignment = { ...current, [v.name]: val };
      const okSoFar = checkMandatoryPartial(next, constraints);
      if (okSoFar) backtrack(i + 1, next);
    }
  }

  backtrack(0, {});
  return solutions;
}

export type SelectionResult<TContext extends ConstraintContext> = {
  indices: number[];
  score: number;
  evaluations: ConstraintResult[][];
};

function computeScores(res: ConstraintResult[]): { score: number; mandatoryScore: number; optionalScore: number; ok: boolean } {
  const totalMandatory = res.filter((r) => r.mandatory).length;
  const satisfiedMandatory = res.filter((r) => r.mandatory && r.ok).length;
  const totalOptional = res.filter((r) => !r.mandatory).length;
  const satisfiedOptional = res.filter((r) => !r.mandatory && r.ok).length;
  const mandatoryScore = totalMandatory > 0 ? satisfiedMandatory / totalMandatory : 1;
  const optionalScore = totalOptional > 0 ? satisfiedOptional / totalOptional : 1;
  const score = Math.round((mandatoryScore * 0.8 + optionalScore * 0.2) * 100);
  const ok = totalMandatory === 0 ? true : satisfiedMandatory === totalMandatory;
  return { score, mandatoryScore, optionalScore, ok };
}

export function solveSelection<TContext extends ConstraintContext>(
  items: TContext[],
  constraints: Constraint<TContext>[],
  k: number,
): SelectionResult<TContext> {
  const n = items.length;
  const evalsAll: ConstraintResult[][] = new Array(n);
  const scoresAll: number[] = new Array(n);
  const okMandatory: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const res = evaluateConstraints(constraints, items[i]);
    evalsAll[i] = res;
    const s = computeScores(res);
    scoresAll[i] = s.score;
    okMandatory[i] = s.ok;
  }

  const candidates = Array.from({ length: n }, (_, i) => i).filter((i) => okMandatory[i]);
  const fallbackCandidates = Array.from({ length: n }, (_, i) => i);
  const base = candidates.length > 0 ? candidates : fallbackCandidates;
  base.sort((a, b) => scoresAll[b] - scoresAll[a]);
  const prefixBest: number[] = new Array(base.length + 1).fill(0);
  for (let i = 0; i < base.length; i++) {
    prefixBest[i + 1] = prefixBest[i] + scoresAll[base[i]];
  }

  const choose = Math.min(k, base.length);
  let bestScore = -1;
  let bestIndices: number[] = [];

  function backtrack(idx: number, chosen: number[], current: number) {
    const remaining = choose - chosen.length;
    if (remaining === 0) {
      if (current > bestScore) {
        bestScore = current;
        bestIndices = chosen.slice();
      }
      return;
    }
    const left = base.length - idx;
    if (left < remaining) return;
    const optimistic = current + (prefixBest[idx + remaining] - prefixBest[idx]);
    if (optimistic <= bestScore) return;
    for (let i = idx; i < base.length; i++) {
      const cand = base[i];
      chosen.push(cand);
      backtrack(i + 1, chosen, current + scoresAll[cand]);
      chosen.pop();
    }
  }

  if (choose > 0) {
    backtrack(0, [], 0);
  }

  const selectedEvals = bestIndices.map((i) => evalsAll[i]);
  return { indices: bestIndices, score: bestScore < 0 ? 0 : bestScore, evaluations: selectedEvals };
}

function cloneDomains(dom: Record<string, unknown[]>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const k of Object.keys(dom)) out[k] = dom[k].slice();
  return out;
}

function checkMandatory(assign: Assignment, constraints: Constraint<Assignment>[]): boolean {
  for (const c of constraints) {
    const mandatory = c.mandatory ?? true;
    if (!mandatory) continue;
    if (!safeCheck(c as Constraint<Assignment>, assign)) return false;
  }
  return true;
}

function checkMandatoryPartial(assign: Assignment, constraints: Constraint<Assignment>[]): boolean {
  for (const c of constraints) {
    const mandatory = c.mandatory ?? true;
    if (!mandatory) continue;
    try {
      if (!c.check(assign as Assignment)) return false;
    } catch (_) {
      continue;
    }
  }
  return true;
}

export function forwardCheckingSolve(
  variables: Variable[],
  constraints: Constraint<Assignment>[],
  solutionLimit = 1,
): Assignment[] {
  const names = variables.map((v) => v.name);
  const baseDomains: Record<string, unknown[]> = {};
  for (const v of variables) baseDomains[v.name] = v.domain.slice();
  const solutions: Assignment[] = [];

  function pickVar(assign: Assignment, domains: Record<string, unknown[]>): string | null {
    let best: string | null = null;
    let bestSize = Infinity;
    for (const n of names) {
      if (n in assign) continue;
      const size = domains[n]?.length ?? 0;
      if (size < bestSize) {
        best = n;
        bestSize = size;
      }
    }
    return best;
  }

  function prune(assign: Assignment, domains: Record<string, unknown[]>): boolean {
    for (const n of names) {
      if (n in assign) continue;
      const dom = domains[n] || [];
      const kept: unknown[] = [];
      for (const v of dom) {
        const a = { ...assign, [n]: v };
        if (checkMandatoryPartial(a, constraints)) kept.push(v);
      }
      domains[n] = kept;
      if (kept.length === 0) return false;
    }
    return true;
  }

  function backtrack(assign: Assignment, domains: Record<string, unknown[]>) {
    if (solutions.length >= solutionLimit) return;
    if (Object.keys(assign).length === names.length) {
      if (checkMandatory(assign, constraints)) solutions.push({ ...assign });
      return;
    }
    const varName = pickVar(assign, domains);
    if (!varName) return;
    const dom = domains[varName] || [];
    if (dom.length === 0) return;
    for (const val of dom) {
      const nextAssign = { ...assign, [varName]: val };
      const nextDomains = cloneDomains(domains);
      nextDomains[varName] = [val];
      if (!checkMandatory(nextAssign, constraints)) continue;
      if (!prune(nextAssign, nextDomains)) continue;
      backtrack(nextAssign, nextDomains);
      if (solutions.length >= solutionLimit) return;
    }
  }

  const initialDomains = cloneDomains(baseDomains);
  if (!prune({}, initialDomains)) return [];
  backtrack({}, initialDomains);
  return solutions;
}