async function requestApi<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Request failed.');
  return data;
}

// React development StrictMode and simultaneous refreshes must not create competing
// anonymous sessions before the first browser cookie is installed.
let bootstrap: Promise<any> | null = null;
export function api<T = any>(path: string, body?: unknown): Promise<T> {
  if (path === '/bootstrap' && body === undefined) {
    if (!bootstrap)
      bootstrap = requestApi(path).finally(() => {
        bootstrap = null;
      });
    return bootstrap;
  }
  return requestApi<T>(path, body);
}
