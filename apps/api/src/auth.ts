import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { User } from '@ugra/contracts';
import type { KernelStore } from '@ugra/core';

const COOKIE_NAME = 'ugra_session';
const MAX_AGE_SECONDS = 60 * 60 * 24;

function secret(): string {
  return process.env.SESSION_SECRET ?? 'dev-secret-change-me';
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function createSessionCookie(userId: string, key = secret()): string {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `v1.${Buffer.from(userId, 'utf8').toString('base64url')}.${expires}`;
  return `${payload}.${sign(payload, key)}`;
}

export function readSessionCookie(value: string | undefined, key = secret()): { userId: string } | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [version, encoded, expires, signature] = parts;
  if (version !== 'v1' || !encoded || !expires || !signature) return null;
  const payload = `v1.${encoded}.${expires}`;
  const expected = sign(payload, key);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  if (Number(expires) * 1000 < Date.now()) return null;
  return { userId: Buffer.from(encoded, 'base64url').toString('utf8') };
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    const name = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
  }
  return result;
}

export function sessionCookieHeader(userId: string): string {
  return `${COOKIE_NAME}=${createSessionCookie(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export async function resolveRequestUser(request: FastifyRequest, store: KernelStore): Promise<User | null> {
  const cookies = parseCookies(request.headers.cookie);
  const session = readSessionCookie(cookies[COOKIE_NAME]);
  if (!session) return null;
  return store.getUser(session.userId);
}
