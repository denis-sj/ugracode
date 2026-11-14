import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@ugra/core';
import { buildServer } from '../src/server';
import { seedUsers, testPorts, testReferenceData } from './helpers';

async function setup(): Promise<{
  ctx: Awaited<ReturnType<typeof buildServer>>;
  cookie: string;
  store: MemoryStore;
}> {
  const store = new MemoryStore();
  const users = await seedUsers(store);
  const data = testReferenceData();
  const ctx = await buildServer({
    store,
    ports: testPorts(),
    data: { ...data, extra: { cmdb: { equipment: [{ id: 'eq-pc-b311', type: 'ПК', model: 'Dell OptiPlex' }] } } },
    env: { AI_MODE: 'stub' },
  });
  const session = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId: users.applicant.id } });
  const raw = session.headers['set-cookie'];
  const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  return { ctx, cookie, store };
}

describe('GET /api/profile', () => {
  it('отдаёт профиль заявителя и подпись техники из CMDB', async () => {
    const { ctx, cookie, store } = await setup();
    await store.saveApplicantProfile({
      userId: 'u-applicant-1',
      building: 'Б',
      floor: '3',
      cabinet: '311',
      equipmentId: 'eq-pc-b311',
    });
    await store.saveApplicantEquipment({
      id: 'aeq-1',
      userId: 'u-applicant-1',
      equipmentId: 'eq-pc-b311',
      note: 'рабочий ПК',
    });
    const response = await ctx.app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      user: { fullName: string };
      profile: { building: string; cabinet: string };
      equipment: { label: string; note: string }[];
    };
    expect(body.user.fullName).toBe('Денис Соколов');
    expect(body.profile.building).toBe('Б');
    expect(body.profile.cabinet).toBe('311');
    expect(body.equipment[0]?.label).toContain('Dell');
    expect(body.equipment[0]?.note).toBe('рабочий ПК');
  });

  it('у пользователя без профиля — пустые данные', async () => {
    const { ctx, cookie } = await setup();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } });
    const body = response.json() as { profile: null; equipment: unknown[] };
    expect(body.profile).toBeNull();
    expect(body.equipment).toEqual([]);
  });

  it('без входа — 401', async () => {
    const { ctx } = await setup();
    const response = await ctx.app.inject({ method: 'GET', url: '/api/profile' });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/logout', () => {
  it('сбрасывает cookie сессии', async () => {
    const { ctx, cookie } = await setup();
    const response = await ctx.app.inject({ method: 'POST', url: '/api/logout', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    const setCookie = String(response.headers['set-cookie'] ?? '');
    expect(setCookie).toContain('ugra_session=');
    expect(setCookie).toContain('Max-Age=0');
  });
});
