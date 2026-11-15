import { describe, expect, it } from 'vitest';
import type { TtsPort } from '@ugra/core';
import { MemoryStore } from '@ugra/core';
import { pcmToWav } from '@ugra/adapters';
import { buildServer } from '../src/server';
import { buildingCode, equipmentLabel, floorOfCabinet, newUserId } from '../src/people-routes';
import { TtsCache, ttsCacheKey, warmTts } from '../src/tts';
import { seedUsers, testPorts, testReferenceData } from './helpers';

const CMDB = {
  locations: [
    { id: 'bld-b', kind: 'building', name: 'Корпус Б', parentId: null },
    { id: 'bld-prom', kind: 'building', name: 'Промплощадка', parentId: null },
    { id: 'floor-b-3', kind: 'floor', name: 'Этаж 3', parentId: 'bld-b' },
  ],
  equipment: [
    { id: 'eq-printer-b312', type: 'printer', model: 'HP LaserJet Pro M404dn', building: 'Б', cabinet: '312' },
    { id: 'eq-pc-b311', type: 'pc', model: 'Dell OptiPlex 7010', building: 'Б', cabinet: '311' },
  ],
};

async function setup(): Promise<{
  ctx: Awaited<ReturnType<typeof buildServer>>;
  store: MemoryStore;
  login: (userId: string) => Promise<string>;
}> {
  const store = new MemoryStore();
  await seedUsers(store);
  const data = testReferenceData();
  const ctx = await buildServer({
    store,
    ports: testPorts(),
    data: {
      ...data,
      dictionaries: [...data.dictionaries, { dictionary: 'equipmentType', code: 'printer', label: 'Принтер' }],
      extra: { cmdb: CMDB },
    },
    env: { AI_MODE: 'stub' },
  });
  const login = async (userId: string): Promise<string> => {
    const session = await ctx.app.inject({ method: 'POST', url: '/api/session', payload: { userId } });
    const raw = session.headers['set-cookie'];
    return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  };
  return { ctx, store, login };
}

describe('помощники people-routes', () => {
  it('код корпуса из названия CMDB', () => {
    expect(buildingCode('Корпус Б')).toBe('Б');
    expect(buildingCode('Промплощадка')).toBe('ПРОМ');
  });

  it('этаж по номеру кабинета', () => {
    expect(floorOfCabinet('312')).toBe('3');
    expect(floorOfCabinet('1024')).toBe('1');
    expect(floorOfCabinet('ВЦ-1')).toBeNull();
    expect(floorOfCabinet('7')).toBeNull();
  });

  it('подпись техники и id сотрудника', () => {
    expect(equipmentLabel({ id: 'x', type: 'printer', model: 'HP' }, new Map([['printer', 'Принтер']]))).toBe('Принтер HP');
    expect(equipmentLabel({ id: 'x' }, new Map())).toBe('x');
    expect(newUserId('engineer', () => 'abc12345')).toBe('u-engineer-abc12345');
  });
});

describe('профиль: место и техника', () => {
  it('справочник корпусов и техники для форм', async () => {
    const { ctx, login } = await setup();
    const cookie = await login('u-dispatcher-1');
    const response = await ctx.app.inject({ method: 'GET', url: '/api/profile/options', headers: { cookie } });
    const body = response.json() as { buildings: { code: string }[]; equipment: { id: string; label: string }[] };
    expect(body.buildings.map((item) => item.code)).toEqual(['Б', 'ПРОМ']);
    expect(body.equipment.find((item) => item.id === 'eq-printer-b312')?.label).toBe('Принтер HP LaserJet Pro M404dn');
  });

  it('сохраняет корпус и кабинет, этаж берёт из номера', async () => {
    const { ctx, store, login } = await setup();
    const cookie = await login('u-manager-1');
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/profile/place',
      headers: { cookie },
      payload: { building: 'Б', cabinet: '205' },
    });
    expect(response.statusCode).toBe(200);
    const profile = await store.getApplicantProfile('u-manager-1');
    expect(profile).toMatchObject({ building: 'Б', floor: '2', cabinet: '205', equipmentId: null });
  });

  it('пустой кабинет — 400', async () => {
    const { ctx, login } = await setup();
    const cookie = await login('u-manager-1');
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/profile/place',
      headers: { cookie },
      payload: { building: 'Б', cabinet: ' ' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('добавляет технику из CMDB, первая становится основной, открепление её снимает', async () => {
    const { ctx, store, login } = await setup();
    const cookie = await login('u-manager-1');
    await ctx.app.inject({ method: 'PATCH', url: '/api/profile/place', headers: { cookie }, payload: { building: 'Б', cabinet: '312' } });
    const added = await ctx.app.inject({
      method: 'POST',
      url: '/api/profile/equipment',
      headers: { cookie },
      payload: { equipmentId: 'eq-printer-b312' },
    });
    expect(added.statusCode).toBe(200);
    expect(await store.listApplicantEquipment('u-manager-1')).toHaveLength(1);
    expect((await store.getApplicantProfile('u-manager-1'))?.equipmentId).toBe('eq-printer-b312');

    const id = (added.json() as { item: { id: string } }).item.id;
    const removed = await ctx.app.inject({ method: 'POST', url: `/api/profile/equipment/${id}/remove`, headers: { cookie } });
    expect(removed.statusCode).toBe(200);
    expect(await store.listApplicantEquipment('u-manager-1')).toHaveLength(0);
    expect((await store.getApplicantProfile('u-manager-1'))?.equipmentId).toBeNull();
  });

  it('неизвестная техника — 404, чужая или несуществующая запись — 404', async () => {
    const { ctx, login } = await setup();
    const cookie = await login('u-manager-1');
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/profile/equipment',
      headers: { cookie },
      payload: { equipmentId: 'eq-nope' },
    });
    expect(unknown.statusCode).toBe(404);
    const missing = await ctx.app.inject({ method: 'POST', url: '/api/profile/equipment/aeq-nope/remove', headers: { cookie } });
    expect(missing.statusCode).toBe(404);
  });

  it('без входа — 401', async () => {
    const { ctx } = await setup();
    const response = await ctx.app.inject({ method: 'PATCH', url: '/api/profile/place', payload: { building: 'Б', cabinet: '1' } });
    expect(response.statusCode).toBe(401);
  });
});

describe('сотрудники руководителя', () => {
  it('руководитель заводит сотрудника с ролью и местом', async () => {
    const { ctx, store, login } = await setup();
    const cookie = await login('u-manager-1');
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { fullName: 'Мария Иванова', role: 'engineer', position: 'Инженер', building: 'Б', cabinet: '312' },
    });
    expect(response.statusCode).toBe(200);
    const created = (response.json() as { user: { id: string; role: string } }).user;
    expect(created.role).toBe('engineer');
    expect(created.id).toMatch(/^u-engineer-/);
    expect((await store.getApplicantProfile(created.id))?.cabinet).toBe('312');
  });

  it('руководитель меняет роль, но не свою', async () => {
    const { ctx, store, login } = await setup();
    const cookie = await login('u-manager-1');
    const changed = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/users/u-applicant-1/role',
      headers: { cookie },
      payload: { role: 'dispatcher' },
    });
    expect(changed.statusCode).toBe(200);
    expect((await store.getUser('u-applicant-1'))?.role).toBe('dispatcher');

    const own = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/users/u-manager-1/role',
      headers: { cookie },
      payload: { role: 'applicant' },
    });
    expect(own.statusCode).toBe(400);
    const missing = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/users/u-nope/role',
      headers: { cookie },
      payload: { role: 'applicant' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('диспетчеру заводить сотрудников и менять роли нельзя', async () => {
    const { ctx, login } = await setup();
    const cookie = await login('u-dispatcher-1');
    const create = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { fullName: 'Кто-то Новый', role: 'admin', position: 'x1' },
    });
    expect(create.statusCode).toBe(403);
    const role = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/users/u-applicant-1/role',
      headers: { cookie },
      payload: { role: 'admin' },
    });
    expect(role.statusCode).toBe(403);
  });

  it('неизвестная роль — 400', async () => {
    const { ctx, login } = await setup();
    const cookie = await login('u-manager-1');
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { fullName: 'Мария Иванова', role: 'boss', position: 'Инженер' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('прогрев голоса звонка', () => {
  const AUDIO = pcmToWav(new Uint8Array(480));

  function port(fail = false, available = true): { tts: TtsPort; spoken: string[] } {
    const spoken: string[] = [];
    return {
      spoken,
      tts: {
        available,
        async speak(request) {
          spoken.push(request.text);
          if (fail) throw new Error('провайдер упал');
          return { audio: AUDIO, mimeType: 'audio/wav', voice: 'Kore' };
        },
      },
    };
  }

  it('кладёт фразы в кэш по тому же ключу, что маршрут, и не синтезирует повторно', async () => {
    const cache = new TtsCache();
    const { tts, spoken } = port();
    expect(await warmTts(cache, { tts }, ['Здравствуйте,  это ИИ', '', 'Секунду'])).toBe(2);
    expect(cache.get(ttsCacheKey('Здравствуйте, это ИИ', ''))).toBeDefined();
    expect(await warmTts(cache, { tts }, ['Секунду'])).toBe(0);
    expect(spoken).toEqual(['Здравствуйте, это ИИ', 'Секунду']);
  });

  it('без ключа озвучки ничего не делает, сбой провайдера не роняет запуск', async () => {
    const cache = new TtsCache();
    expect(await warmTts(cache, { tts: port(false, false).tts }, ['Привет'])).toBe(0);
    expect(await warmTts(cache, { tts: port(true).tts }, ['Привет'])).toBe(0);
    expect(cache.size).toBe(0);
  });
});
