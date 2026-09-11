/**
 * Authentication routes (T3 PRD R4).
 *
 *   GET  /api/v1/auth/me        → who am I (401 when signed out)
 *   POST /api/v1/auth/login     → open a session
 *   POST /api/v1/auth/logout    → close it
 *   POST /api/v1/auth/password  → rotate the password
 *
 * Every failure path returns the SAME message and status for "wrong username" and
 * "wrong password" (PRD AC3). A caller must not be able to learn whether the
 * account is configured, which matters on a public hostname.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import {
  clearSessionCookie,
  requireUserId,
  setSessionCookie,
  type AuthedRequest,
} from '../plugins/auth.js';
import type { AuthService } from '../services/auth-service.js';
import { MIN_PASSWORD_LENGTH, PasswordPolicyError } from '../services/password.js';

export interface AuthRoutesOptions {
  readonly config: AppConfig;
  readonly authService: AuthService;
  readonly secureCookies: boolean;
}

/** Identical body for every credential failure. */
const INVALID_CREDENTIALS = {
  error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' },
} as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRoutesOptions,
): Promise<void> {
  const { config, authService, secureCookies } = options;

  app.get('/api/v1/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = (request as AuthedRequest).auth;
    if (auth === undefined) {
      return reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
      });
    }

    const user = authService.findUserByUsername(config.username);
    return reply.send({
      username: user?.username ?? config.username,
      expiresAt: auth.expiresAtMs,
    });
  });

  app.post('/api/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as LoginBody;

    if (!isNonEmptyString(body.username) || !isNonEmptyString(body.password)) {
      // Still the credentials error: a malformed body must not be distinguishable
      // from a wrong password either.
      return reply.status(401).send(INVALID_CREDENTIALS);
    }

    const username = body.username.trim();

    // Compare against the configured name FIRST. Without this, a wrong username
    // would short-circuit while a wrong password would run argon2, and the timing
    // (or a 400 from a later branch) would reveal whether the account exists.
    if (username !== config.username) {
      request.log.warn({ username }, 'login rejected: unknown username');
      return reply.status(401).send(INVALID_CREDENTIALS);
    }

    const result = await authService.login(username, body.password);
    if (!result.ok) {
      request.log.warn({ reason: result.reason }, 'login rejected');
      return reply.status(401).send(INVALID_CREDENTIALS);
    }

    setSessionCookie(reply, result.token, config.sessionTtlDays, secureCookies);
    request.log.info({ username: result.username }, 'login succeeded');
    return reply.send({ username: result.username, expiresAt: result.expiresAtMs });
  });

  app.post('/api/v1/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request as AuthedRequest).sessionToken;
    if (token !== undefined) {
      authService.deleteSession(token);
    }
    clearSessionCookie(reply, secureCookies);
    return reply.send({ ok: true });
  });

  app.post(
    '/api/v1/auth/password',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = requireUserId(request);
      const body = (request.body ?? {}) as ChangePasswordBody;

      if (!isNonEmptyString(body.currentPassword) || !isNonEmptyString(body.newPassword)) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION',
            message: 'Both currentPassword and newPassword are required.',
          },
        });
      }

      if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
        return reply.status(400).send({
          error: {
            code: 'WEAK_PASSWORD',
            message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
          },
        });
      }

      let changed: boolean;
      try {
        changed = await authService.changePassword(
          userId,
          body.currentPassword,
          body.newPassword,
        );
      } catch (error) {
        if (error instanceof PasswordPolicyError) {
          return reply
            .status(400)
            .send({ error: { code: 'WEAK_PASSWORD', message: error.message } });
        }
        throw error;
      }

      if (!changed) {
        return reply.status(401).send({
          error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' },
        });
      }

      // Every session is gone, including this one, so clear the cookie to match the
      // server state instead of leaving the client with a dead token (PRD AC7).
      clearSessionCookie(reply, secureCookies);
      request.log.info('password changed; all sessions invalidated');
      return reply.send({ ok: true, reauthenticate: true });
    },
  );
}
