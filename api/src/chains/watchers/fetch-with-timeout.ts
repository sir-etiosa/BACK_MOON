/** Every outbound call a watcher makes to a third-party API must be bounded — an external
 * provider hanging must never be able to wedge our cron endpoint indefinitely. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
