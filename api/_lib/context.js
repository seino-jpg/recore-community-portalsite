// ハンドラが使う実行文脈。テストでは fetch・now・env を差し替える
export function createContext(overrides = {}) {
  return {
    env: process.env,
    fetch: (...args) => globalThis.fetch(...args),
    now: () => Date.now(),
    ...overrides
  };
}
