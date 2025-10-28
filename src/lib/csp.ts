export type ConstraintContext = Record<string, unknown>;

export interface Constraint<TContext extends ConstraintContext = ConstraintContext> {
  id: string;
  label: string;
  check: (ctx: TContext) => boolean;
}

export interface ConstraintResult {
  id: string;
  label: string;
  ok: boolean;
}

/**
 * Evaluate a set of constraints against a context (typically one result item).
 */
export function evaluateConstraints<TContext extends ConstraintContext>(
  constraints: Constraint<TContext>[],
  ctx: TContext,
): ConstraintResult[] {
  return constraints.map((c) => ({ id: c.id, label: c.label, ok: safeCheck(c, ctx) }));
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
      // Check final constraints
      const allOk = constraints.every((c) => safeCheck(c, current));
      if (allOk) solutions.push({ ...current });
      return;
    }
    const v = variables[i];
    for (const val of v.domain) {
      const next: Assignment = { ...current, [v.name]: val };
      // Early pruning using constraints that only touch assigned vars
      const okSoFar = constraints.every((c) => safeCheck(c, next));
      if (okSoFar) backtrack(i + 1, next);
    }
  }

  backtrack(0, {});
  return solutions;
}