export interface Account {
  id: string;
  email: string;
  emailVerifiedAt: string;
}

export interface SendMagicLinkResponse {
  requestId: string;
  expiresAt: string;
  resendAvailableAt: string;
}

export interface ResendMagicLinkResponse {
  confirmation: string;
  expiresAt: string;
  resendAvailableAt: string;
}

export interface SessionResponse {
  account: Account;
  setupComplete: boolean;
  next: '/setup' | '/log/today';
}

interface ErrorResponse {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  resendAvailableAt?: string;
}

export class ApiError extends Error {
  code: string;
  retryable: boolean;
  requestId?: string;
  resendAvailableAt?: string;

  constructor(response: ErrorResponse) {
    super(response.message);
    this.name = 'ApiError';
    this.code = response.code;
    this.retryable = response.retryable;
    this.requestId = response.requestId;
    this.resendAvailableAt = response.resendAvailableAt;
  }
}

const requestJson = async <Response>(
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json()) as ErrorResponse;
    throw new ApiError(body);
  }

  return response.status === 204
    ? (undefined as Response)
    : ((await response.json()) as Response);
};

export const sendMagicLink = (email: string) =>
  requestJson<SendMagicLinkResponse>('/v1/auth/magic-links', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ email }),
  });

export const resendMagicLink = (requestId: string) =>
  requestJson<ResendMagicLinkResponse>(
    `/v1/auth/magic-links/${encodeURIComponent(requestId)}/resend`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: '{}',
    },
  );

export const exchangeMagicLink = (token: string) =>
  requestJson<SessionResponse>('/v1/auth/sessions', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });

export const getSession = () => requestJson<SessionResponse>('/v1/auth/session');

export const signOut = () =>
  requestJson<void>('/v1/auth/session', { method: 'DELETE' });

export const getMockLink = (requestId: string) =>
  requestJson<{ email: string; href: string }>(
    `/_mock/magic-links/${encodeURIComponent(requestId)}`,
  );
