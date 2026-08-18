import { createHash, randomBytes } from 'node:crypto';

import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { validate as validateUuid, v7 as uuidv7 } from 'uuid';

const MAGIC_LINK_LIFETIME_SECONDS = 15 * 60;
const LOGIN_REQUEST_LIFETIME_SECONDS = 30 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const SESSION_COOKIE = '__Host-session';

type TokenStatus =
  | 'active'
  | 'consumed'
  | 'delivery_failed'
  | 'superseded';

interface LoginRequest {
  id: string;
  email: string;
  emailKey: string;
  createKey: string;
  createdAt: number;
  expiresAt: number;
  lastDeliveryAt: number | null;
}

interface MagicToken {
  id: string;
  requestId: string;
  rawToken: string;
  tokenHash: string;
  deliveryKey: string;
  status: TokenStatus;
  createdAt: number;
  expiresAt: number;
}

interface Account {
  id: string;
  email: string;
  emailKey: string;
  emailVerifiedAt: number;
  onboardingCompletedAt: number | null;
}

interface Session {
  id: string;
  accountId: string;
  rawToken: string;
  tokenHash: string;
  createdAt: number;
  revokedAt: number | null;
}

const loginRequests = new Map<string, LoginRequest>();
const requestIdsByCreateKey = new Map<string, string>();
const magicTokens = new Map<string, MagicToken>();
const accountsByEmailKey = new Map<string, Account>();
const sessionsByHash = new Map<string, Session>();

const now = () => Math.floor(Date.now() / 1000);
const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const createToken = () => randomBytes(32).toString('base64url');
const normalizeEmail = (email: string) =>
  email.trim().normalize('NFKC').toLocaleLowerCase('en-US');
const isEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;

const accountJson = (account: Account) => ({
  id: account.id,
  email: account.email,
  emailVerifiedAt: new Date(account.emailVerifiedAt * 1000).toISOString(),
});

const errorBody = (code: string, message: string, retryable: boolean) => ({
  code,
  message,
  retryable,
});

const getIdempotencyKey = (request: Request, response: Response) => {
  const value = request.get('Idempotency-Key');
  if (!value || !validateUuid(value)) {
    response
      .status(400)
      .json(errorBody('INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key header is required.', false));
    return null;
  }

  return value;
};

const createMagicToken = (
  requestId: string,
  deliveryKey: string,
  status: TokenStatus,
) => {
  const timestamp = now();
  const rawToken = createToken();
  const token: MagicToken = {
    id: uuidv7(),
    requestId,
    rawToken,
    tokenHash: hashToken(rawToken),
    deliveryKey,
    status,
    createdAt: timestamp,
    expiresAt: timestamp + MAGIC_LINK_LIFETIME_SECONDS,
  };
  magicTokens.set(token.id, token);
  return token;
};

const findToken = (rawToken: string) => {
  const digest = hashToken(rawToken);
  return [...magicTokens.values()].find((token) => token.tokenHash === digest);
};

const findActiveTokenForRequest = (requestId: string) =>
  [...magicTokens.values()]
    .filter((token) => token.requestId === requestId && token.status === 'active')
    .sort((left, right) => right.createdAt - left.createdAt)[0];

const sessionFromRequest = (request: Request) => {
  const rawToken = request.cookies[SESSION_COOKIE] as string | undefined;
  if (!rawToken) return undefined;
  const session = sessionsByHash.get(hashToken(rawToken));
  if (!session || session.revokedAt) return undefined;
  return session;
};

const setSessionCookie = (response: Response, token: string) => {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: true,
  });
};

export const resetMockStore = () => {
  loginRequests.clear();
  requestIdsByCreateKey.clear();
  magicTokens.clear();
  accountsByEmailKey.clear();
  sessionsByHash.clear();
};

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  app.post('/v1/auth/magic-links', (request, response) => {
    const idempotencyKey = getIdempotencyKey(request, response);
    if (!idempotencyKey) return;

    const existingRequestId = requestIdsByCreateKey.get(idempotencyKey);
    if (existingRequestId) {
      const existing = loginRequests.get(existingRequestId);
      if (existing) {
        const activeToken = findActiveTokenForRequest(existing.id);
        response.status(activeToken ? 202 : 503).json({
          ...(activeToken
            ? {}
            : errorBody('EMAIL_DELIVERY_UNAVAILABLE', 'We could not send the sign-in email. Please try again.', true)),
          requestId: existing.id,
          expiresAt: new Date((activeToken?.expiresAt ?? existing.expiresAt) * 1000).toISOString(),
          resendAvailableAt: new Date((existing.lastDeliveryAt ?? now()) * 1000).toISOString(),
        });
        return;
      }
    }

    const email = typeof request.body?.email === 'string' ? request.body.email.trim() : '';
    if (!isEmail(email)) {
      response
        .status(422)
        .json(errorBody('INVALID_EMAIL', 'Enter a valid email address.', false));
      return;
    }

    const timestamp = now();
    const loginRequest: LoginRequest = {
      id: uuidv7(),
      email,
      emailKey: normalizeEmail(email),
      createKey: idempotencyKey,
      createdAt: timestamp,
      expiresAt: timestamp + LOGIN_REQUEST_LIFETIME_SECONDS,
      lastDeliveryAt: null,
    };
    loginRequests.set(loginRequest.id, loginRequest);
    requestIdsByCreateKey.set(idempotencyKey, loginRequest.id);

    const simulateFailure = loginRequest.emailKey === 'delivery-failure@example.com';
    const token = createMagicToken(
      loginRequest.id,
      idempotencyKey,
      simulateFailure ? 'delivery_failed' : 'active',
    );

    if (simulateFailure) {
      response.status(503).json({
        ...errorBody('EMAIL_DELIVERY_UNAVAILABLE', 'We could not send the sign-in email. Please try again.', true),
        requestId: loginRequest.id,
      });
      return;
    }

    loginRequest.lastDeliveryAt = timestamp;
    response.status(202).json({
      requestId: loginRequest.id,
      expiresAt: new Date(token.expiresAt * 1000).toISOString(),
      resendAvailableAt: new Date((timestamp + RESEND_COOLDOWN_SECONDS) * 1000).toISOString(),
    });
  });

  app.post('/v1/auth/magic-links/:requestId/resend', (request, response) => {
    const idempotencyKey = getIdempotencyKey(request, response);
    if (!idempotencyKey) return;

    const loginRequest = loginRequests.get(request.params.requestId);
    if (!loginRequest) {
      response.status(404).json(errorBody('LOGIN_REQUEST_NOT_FOUND', 'This sign-in request was not found.', false));
      return;
    }
    if (loginRequest.expiresAt <= now()) {
      response.status(410).json(errorBody('LOGIN_REQUEST_EXPIRED', 'This sign-in request has expired. Start again.', false));
      return;
    }
    if (
      loginRequest.lastDeliveryAt &&
      loginRequest.lastDeliveryAt + RESEND_COOLDOWN_SECONDS > now()
    ) {
      response.status(429).json({
        ...errorBody('RESEND_COOLDOWN', 'Please wait before sending another email.', true),
        resendAvailableAt: new Date(
          (loginRequest.lastDeliveryAt + RESEND_COOLDOWN_SECONDS) * 1000,
        ).toISOString(),
      });
      return;
    }

    const previousActiveToken = findActiveTokenForRequest(loginRequest.id);
    const token = createMagicToken(loginRequest.id, idempotencyKey, 'active');
    if (previousActiveToken) previousActiveToken.status = 'superseded';
    loginRequest.lastDeliveryAt = now();

    response.status(202).json({
      confirmation: 'A new sign-in link is on its way.',
      expiresAt: new Date(token.expiresAt * 1000).toISOString(),
      resendAvailableAt: new Date(
        (loginRequest.lastDeliveryAt + RESEND_COOLDOWN_SECONDS) * 1000,
      ).toISOString(),
    });
  });

  app.post('/v1/auth/sessions', (request, response) => {
    const rawToken = typeof request.body?.token === 'string' ? request.body.token : '';
    const token = rawToken ? findToken(rawToken) : undefined;
    if (!token) {
      response.status(400).json(errorBody('INVALID_MAGIC_LINK', 'This sign-in link is not valid.', false));
      return;
    }
    if (token.status === 'consumed') {
      response.status(409).json(errorBody('MAGIC_LINK_USED', 'This sign-in link has already been used.', false));
      return;
    }
    if (token.status === 'superseded') {
      response.status(410).json(errorBody('MAGIC_LINK_SUPERSEDED', 'A newer sign-in link was requested. Use the latest email.', false));
      return;
    }
    if (token.status !== 'active' || token.expiresAt <= now()) {
      response.status(410).json(errorBody('MAGIC_LINK_EXPIRED', 'This sign-in link has expired. Request a new one.', false));
      return;
    }

    const loginRequest = loginRequests.get(token.requestId);
    if (!loginRequest) {
      response.status(400).json(errorBody('INVALID_MAGIC_LINK', 'This sign-in link is not valid.', false));
      return;
    }

    token.status = 'consumed';
    let account = accountsByEmailKey.get(loginRequest.emailKey);
    if (!account) {
      account = {
        id: uuidv7(),
        email: loginRequest.email,
        emailKey: loginRequest.emailKey,
        emailVerifiedAt: now(),
        onboardingCompletedAt: null,
      };
      accountsByEmailKey.set(account.emailKey, account);
    }

    const rawSessionToken = createToken();
    const session: Session = {
      id: uuidv7(),
      accountId: account.id,
      rawToken: rawSessionToken,
      tokenHash: hashToken(rawSessionToken),
      createdAt: now(),
      revokedAt: null,
    };
    sessionsByHash.set(session.tokenHash, session);
    setSessionCookie(response, rawSessionToken);

    const setupComplete = Boolean(account.onboardingCompletedAt);
    response.status(201).json({
      account: accountJson(account),
      setupComplete,
      next: setupComplete ? '/log/today' : '/setup',
    });
  });

  app.get('/v1/auth/session', (request, response) => {
    const session = sessionFromRequest(request);
    if (!session) {
      response.status(401).json(errorBody('UNAUTHENTICATED', 'Sign in to continue.', false));
      return;
    }
    const account = [...accountsByEmailKey.values()].find(
      (candidate) => candidate.id === session.accountId,
    );
    if (!account) {
      response.status(401).json(errorBody('UNAUTHENTICATED', 'Sign in to continue.', false));
      return;
    }

    setSessionCookie(response, session.rawToken);
    const setupComplete = Boolean(account.onboardingCompletedAt);
    response.json({
      account: accountJson(account),
      setupComplete,
      next: setupComplete ? '/log/today' : '/setup',
    });
  });

  app.delete('/v1/auth/session', (request, response) => {
    const session = sessionFromRequest(request);
    if (session) session.revokedAt = now();
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: true,
    });
    response.status(204).end();
  });

  if (process.env.NODE_ENV !== 'production') {
    app.get('/_mock/magic-links/:requestId', (request, response) => {
      const loginRequest = loginRequests.get(request.params.requestId);
      const token = findActiveTokenForRequest(request.params.requestId);
      if (!loginRequest || !token) {
        response.status(404).json(errorBody('MOCK_LINK_NOT_FOUND', 'No active mock link is available.', false));
        return;
      }
      response.json({
        email: loginRequest.email,
        href: `/auth/verify#token=${token.rawToken}`,
      });
    });
  }

  app.use((_request, response) => {
    response.status(404).json(errorBody('NOT_FOUND', 'Route not found.', false));
  });

  app.use(
    (error: Error, _request: Request, response: Response, _next: NextFunction) => {
      console.error(error);
      response
        .status(500)
        .json(errorBody('INTERNAL_ERROR', 'Something went wrong. Please try again.', true));
    },
  );

  return app;
};
