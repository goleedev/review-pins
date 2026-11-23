export async function withRetry<T>(task: () => Promise<T>, attempts = 3, delayMs = 200): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, delayMs * 2 ** i));
    }
  }
  throw lastError;
}
