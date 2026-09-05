/**
 * Free reachability check for a model-supplied source link. A research model
 * will occasionally invent a plausible URL; one HEAD request (GET when the
 * host refuses HEAD) tells the producer whether the article is real before
 * they click "Generate from source". Best-effort: any network failure is
 * "unreachable", never a throw.
 */
export type SourceStatus = 'reachable' | 'unreachable';

const TIMEOUT_MS = 5_000;
const HEADERS = { 'user-agent': 'reel-agent/1.0 (+source check)', accept: 'text/html,*/*' };

export async function checkUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<SourceStatus> {
  if (!/^https?:\/\//i.test(url)) return 'unreachable';
  try {
    let res = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        headers: HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    }
    return res.ok ? 'reachable' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
