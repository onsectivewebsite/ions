/**
 * Mobile tRPC client — fetch-based, mirrors the apps/web pattern.
 *
 * tRPC's HTTP transport encodes calls as either GET (queries) or POST
 * (mutations) at /trpc/<router>.<procedure>. We don't need the full
 * @trpc/client React bindings on mobile; native fetch is fine.
 *
 * Token comes from SecureStore (see session.ts). Pass it in every call so
 * the API's createContext can attach the firm-scope claims.
 */
import Constants from 'expo-constants';

type RpcOpts = { token?: string | null };

function apiBaseUrl(): string {
  const fromManifest = Constants.expoConfig?.extra?.apiBaseUrl as string | undefined;
  return fromManifest ?? 'http://localhost:4000';
}

export class RpcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

async function tryParse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new RpcError('PARSE', `Could not parse response (${res.status})`);
  }
}

export async function rpcQuery<T>(
  procedure: string,
  input: unknown,
  opts: RpcOpts = {},
): Promise<T> {
  const url = `${apiBaseUrl()}/trpc/${procedure}${
    input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
  }`;
  const res = await fetch(url, {
    method: 'GET',
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
  });
  const body = (await tryParse(res)) as
    | { result?: { data?: { json?: T } }; error?: { message?: string; data?: { code?: string } } }
    | null;
  if (!res.ok || body?.error) {
    throw new RpcError(
      body?.error?.data?.code ?? 'HTTP',
      body?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return (body?.result?.data?.json ?? body?.result?.data) as T;
}

export async function rpcMutation<T>(
  procedure: string,
  input: unknown,
  opts: RpcOpts = {},
): Promise<T> {
  const url = `${apiBaseUrl()}/trpc/${procedure}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({ json: input }),
  });
  const body = (await tryParse(res)) as
    | { result?: { data?: { json?: T } }; error?: { message?: string; data?: { code?: string } } }
    | null;
  if (!res.ok || body?.error) {
    throw new RpcError(
      body?.error?.data?.code ?? 'HTTP',
      body?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return (body?.result?.data?.json ?? body?.result?.data) as T;
}
