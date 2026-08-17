import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp, resetMockStore } from './app.js';

const app = createApp();

beforeEach(() => {
  resetMockStore();
});

describe('authentication API integration', () => {
  it('creates a login request, establishes a persistent session, and signs out locally', async () => {
    const send = await request(app)
      .post('/v1/auth/magic-links')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ email: 'reader@example.com' })
      .expect(202);

    const mockLink = await request(app)
      .get(`/_mock/magic-links/${send.body.requestId}`)
      .expect(200);
    const token = new URL(`http://localhost${mockLink.body.href}`).hash.replace('#token=', '');

    const session = await request(app)
      .post('/v1/auth/sessions')
      .send({ token })
      .expect(201);

    expect(session.body).toMatchObject({
      account: { email: 'reader@example.com' },
      setupComplete: false,
      next: '/setup',
    });
    expect(session.headers['set-cookie']?.[0]).toContain('__Host-session=');

    const sessionCookie = session.headers['set-cookie']?.[0]?.split(';')[0];
    expect(sessionCookie).toBeTypeOf('string');

    const current = await request(app)
      .get('/v1/auth/session')
      .set('Cookie', sessionCookie!)
      .expect(200);
    expect(current.body.account.email).toBe('reader@example.com');

    await request(app)
      .delete('/v1/auth/session')
      .set('Cookie', sessionCookie!)
      .expect(204);

    await request(app)
      .get('/v1/auth/session')
      .set('Cookie', sessionCookie!)
      .expect(401);

    await request(app)
      .post('/v1/auth/sessions')
      .send({ token })
      .expect(409);
  });

  it('recovers from delivery failure through resend and link exchange', async () => {
    const failed = await request(app)
      .post('/v1/auth/magic-links')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ email: 'delivery-failure@example.com' })
      .expect(503);

    expect(failed.body).toMatchObject({
      code: 'EMAIL_DELIVERY_UNAVAILABLE',
      retryable: true,
    });
    expect(failed.body.requestId).toBeTypeOf('string');

    await request(app)
      .post(`/v1/auth/magic-links/${failed.body.requestId}/resend`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({})
      .expect(202);

    const mockLink = await request(app)
      .get(`/_mock/magic-links/${failed.body.requestId}`)
      .expect(200);
    const token = new URL(`http://localhost${mockLink.body.href}`).hash.replace('#token=', '');

    await request(app)
      .post('/v1/auth/sessions')
      .send({ token })
      .expect(201);
  });

  it('reuses the original response for an idempotent send retry', async () => {
    const idempotencyKey = crypto.randomUUID();
    const first = await request(app)
      .post('/v1/auth/magic-links')
      .set('Idempotency-Key', idempotencyKey)
      .send({ email: 'reader@example.com' })
      .expect(202);

    const retried = await request(app)
      .post('/v1/auth/magic-links')
      .set('Idempotency-Key', idempotencyKey)
      .send({ email: 'reader@example.com' })
      .expect(202);

    expect(retried.body.requestId).toBe(first.body.requestId);
  });

  it('rejects malformed email addresses', async () => {
    const response = await request(app)
      .post('/v1/auth/magic-links')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ email: 'not-an-email' })
      .expect(422);

    expect(response.body.code).toBe('INVALID_EMAIL');
  });
});
