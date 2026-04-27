/**
 * Minimal client for the API. Avoids the full tRPC client wiring in Phase 0;
 * we just call /trpc with JSON. Phase 0+: replace with `@trpc/client` once
 * we have shared types compiled.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type RpcOpts = { token?: string | null };

export async function rpcQuery<T>(path: string, input: unknown, opts: RpcOpts = {}): Promise<T> {
  const url = `${API_BASE}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;
  return fetchRpc<T>(url, { method: 'GET' }, opts);
}

export async function rpcMutation<T>(path: string, input: unknown, opts: RpcOpts = {}): Promise<T> {
  const url = `${API_BASE}/trpc/${path}`;
  return fetchRpc<T>(url, { method: 'POST', body: JSON.stringify(input) }, opts);
}

async function fetchRpc<T>(url: string, init: RequestInit, opts: RpcOpts): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(url, { ...init, headers, credentials: 'include' });
  const json = (await res.json()) as { result?: { data: T }; error?: { message: string } };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Request failed: ${res.status}`);
  }
  return json.result!.data;
}
