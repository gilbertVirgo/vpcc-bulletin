export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const loginUrl = (hub: string): string => `${hub}/?returnTo=${encodeURIComponent(location.href)}`;

/** JSON call to /api/<path>. A 401 sends the browser to the auth hub and never resolves. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(`/api/${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: hasBody ? { "Content-Type": "application/json" } : {},
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 && typeof body.hub === "string") {
    location.assign(loginUrl(body.hub));
    return new Promise<T>(() => {});
  }
  if (!res.ok) {
    throw new ApiError(typeof body.error === "string" ? body.error : `Request failed (${res.status})`, res.status, body);
  }
  return body as T;
}

export const message = (err: unknown): string => (err instanceof Error ? err.message : "Something went wrong.");

/** The hub clears the shared cookie; it requires a JSON content type. */
export async function logout(hub: string): Promise<void> {
  await fetch(`${hub}/api/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {});
  location.reload();
}
