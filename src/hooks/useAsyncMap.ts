import { useMemo, useState } from "react";

export type AsyncStateMap<T extends string> = Record<T, boolean>;

export function useAsyncMap<const T extends string>(keys: readonly T[]) {
  const initial = useMemo(() => {
    const entryList = keys.map((key) => [key, false] as const);
    return Object.fromEntries(entryList) as AsyncStateMap<T>;
  }, [keys]);

  const [state, setState] = useState<AsyncStateMap<T>>(initial);

  function setAsyncState(key: T, value: boolean) {
    setState((current) => {
      if (current[key] === value) {
        return current;
      }

      return {
        ...current,
        [key]: value,
      };
    });
  }

  return {
    state,
    setAsyncState,
  };
}
