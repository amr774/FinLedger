export type User = {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
};
export type Wallet = {
  id: string;
  balance: string;
  currency: string;
  status: string;
};
export type Transfer = {
  id: string;
  sourceId: string;
  destinationId: string;
  amount: string;
  kind: string;
  createdAt: string;
  status?: string;
  journal?: {
    id: string;
    postings: { id: string; walletId: string; side: string; amount: string }[];
  };
};
export type History = {
  items: Transfer[];
  total: number;
  page: number;
  limit: number;
};
let accessToken: string | null = null;
let renewal: Promise<boolean> | null = null;
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function decode<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      Array.isArray(data?.error?.message)
        ? data.error.message.join('. ')
        : data?.error?.message ||
            `Request failed (${response.status}). Please retry.`,
    );
  if (data === null)
    throw new ApiError(502, 'Invalid server response. Please retry.');
  return data as T;
}
export function renew() {
  if (!renewal) {
    const perform = async () => {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 401) {
        accessToken = null;
        return false;
      }
      accessToken = (await decode<{ accessToken: string }>(res)).accessToken;
      return true;
    };
    renewal = Promise.resolve(
      navigator.locks
        ? navigator.locks.request('finledger-refresh', perform)
        : perform(),
    )
      .then((value) => value)
      .finally(() => {
        renewal = null;
      });
  }
  return renewal;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
  if (
    res.status === 401 &&
    retry &&
    !path.startsWith('/auth/') &&
    (await renew())
  )
    return api<T>(path, options, false);
  return decode<T>(res);
}
export async function authenticate(path: 'login' | 'register', body: unknown) {
  const data = await api<{ accessToken: string }>(
    `/auth/${path}`,
    { method: 'POST', body: JSON.stringify(body) },
    false,
  );
  accessToken = data.accessToken;
}
export async function logout() {
  await api('/auth/logout', { method: 'POST' });
  accessToken = null;
}
export async function currentUser() {
  if (!accessToken && !(await renew()))
    throw new ApiError(401, 'Please sign in');
  return api<User>('/users/me');
}
export function moneyPost<T>(path: string, body: unknown, key: string) {
  return api<T>(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
}
// Keep an uncertain operation across navigation/reload in this browser tab.
// Fail before submitting if storage is unavailable, rather than losing its key.
export async function pendingMoneyPost<T>(
  path: string,
  body: unknown,
  scope: string,
) {
  const storageKey = `finledger:pending:${scope}:${path}:${JSON.stringify(body)}`;
  const key = sessionStorage.getItem(storageKey) || crypto.randomUUID();
  sessionStorage.setItem(storageKey, key);
  const result = await moneyPost<T>(path, body, key);
  sessionStorage.removeItem(storageKey);
  return result;
}
