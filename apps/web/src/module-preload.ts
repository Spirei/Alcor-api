/** Code-only intent loading; never reads API data or authorizes an operation. */
export function modulePreload<T>(load: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending)
      pending = Promise.resolve()
        .then(load)
        .catch((error) => {
          pending = null;
          throw error;
        });
    return pending;
  };
}
