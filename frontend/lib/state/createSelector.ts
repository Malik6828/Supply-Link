/**
 * Minimal reselect-style memoization: caches the last inputs (by reference) and
 * result, recomputing only when an input selector's output actually changes.
 * Keeps `selectors.ts` derived arrays/objects referentially stable across renders
 * so `useStore(selector)` doesn't force a re-render when nothing meaningful changed.
 */
export function createSelector<S, Args extends unknown[], R>(
  inputSelectors: { [K in keyof Args]: (state: S) => Args[K] },
  resultFn: (...args: Args) => R,
): (state: S) => R {
  let lastArgs: Args | null = null;
  let lastResult: R;

  return (state: S): R => {
    const args = inputSelectors.map((select) => select(state)) as Args;
    const inputsChanged =
      lastArgs === null ||
      args.length !== lastArgs.length ||
      args.some((arg, i) => !Object.is(arg, (lastArgs as Args)[i]));

    if (inputsChanged) {
      lastArgs = args;
      lastResult = resultFn(...args);
    }

    return lastResult;
  };
}

/**
 * Factory for parameterized selectors (e.g. "events for product X"). Each call
 * returns a fresh memoized selector instance so per-argument caches don't collide
 * across components using different arguments — callers should memoize the
 * instance itself (e.g. with `useMemo`) keyed on the argument.
 */
export function createParameterizedSelector<S, P, Args extends unknown[], R>(
  inputSelectors: { [K in keyof Args]: (state: S, param: P) => Args[K] },
  resultFn: (...args: Args) => R,
): (param: P) => (state: S) => R {
  return (param: P) => {
    let lastArgs: Args | null = null;
    let lastResult: R;

    return (state: S): R => {
      const args = inputSelectors.map((select) => select(state, param)) as Args;
      const inputsChanged =
        lastArgs === null ||
        args.length !== lastArgs.length ||
        args.some((arg, i) => !Object.is(arg, (lastArgs as Args)[i]));

      if (inputsChanged) {
        lastArgs = args;
        lastResult = resultFn(...args);
      }

      return lastResult;
    };
  };
}
