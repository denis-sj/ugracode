import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildAiExtractionSchema, DictionariesFile, PriorityLevel, Role } from '@ugra/contracts';
import {
  buildLocations,
  buildingLocationId,
  loadSeedData,
  mergeLocations,
} from '../src/seed/load-data';

const data = loadSeedData();

const TESTSET_DIR = fileURLToPath(new URL('../../../testset/', import.meta.url));

interface TestCase {
  id: string;
  channel: string;
  text: string;
  audioFile?: string;
  expected: {
    fields: Record<string, string | null>;
    priority?: string;
    emergency?: boolean;
    assigneeTop3?: string[];
    kbArticle?: string;
  };
}

interface StubFile {
  fields: Array<{ key: string; value: string | null; quote: string | null; confidence: number }>;
  aspects: {
    emergency?: { suspected: boolean; signs: Array<{ sign: string; quote: string }>; confidence: number };
    summary?: { text: string };
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

const CASE_FILES = readdirSync(`${TESTSET_DIR}cases`)
  .filter((name) => name.endsWith('.json'))
  .sort();
const CASES = CASE_FILES.map((name) => ({
  file: name,
  stub: name.slice(0, 2),
  data: readJson<TestCase>(`${TESTSET_DIR}cases/${name}`),
}));
const STUBS = new Map(
  readdirSync(`${TESTSET_DIR}stubs`)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name.replace(/\.json$/, ''), readJson<StubFile>(`${TESTSET_DIR}stubs/${name}`)]),
);

const dictionaryCodes = (name: string): string[] =>
  data.dictionaries.filter((item) => item.dictionary === name).map((item) => item.code);

const FIELD_KEYS = [
  'object',
  'building',
  'floor',
  'cabinet',
  'equipment',
  'model',
  'serial',
  'inventoryNo',
  'ip',
  'errorCode',
  'symptoms',
  'category',
  'serviceType',
  'department',
  'impact',
  'urgency',
];

const locationById = new Map(data.cmdb.locations.map((location) => [location.id, location]));
const equipmentById = new Map(data.cmdb.equipment.map((item) => [item.id, item]));
const engineerById = new Map(data.engineers.map((engineer) => [engineer.id, engineer]));
const articleIds = new Set(data.kbArticles.map((article) => article.id));

describe('реестр полей data/fields.json', () => {
  it('содержит полный базовый набор без дублей', () => {
    expect(data.fields.map((field) => field.key)).toEqual(FIELD_KEYS);
    expect(new Set(FIELD_KEYS).size).toBe(FIELD_KEYS.length);
  });

  it('у каждого обязательного поля есть вопрос-карточка', () => {
    for (const field of data.fields) {
      if (typeof field.required === 'boolean' && field.required) {
        expect(field.ask, `${field.key}: обязательному полю нужен ask`).toBeDefined();
        expect(field.ask?.question.length).toBeGreaterThan(5);
      }
    }
  });

  it('справочные поля ссылаются на существующие справочники', () => {
    for (const field of data.fields) {
      if (field.type !== 'dictionary') continue;
      expect(field.dictionary, `${field.key}: нет имени справочника`).toBeDefined();
      expect(dictionaryCodes(field.dictionary ?? '').length).toBeGreaterThan(0);
      if (field.ask?.optionsFrom) {
        expect(dictionaryCodes(field.ask.optionsFrom).length).toBeGreaterThan(0);
      }
    }
  });

  it('подсказки и шаблоны полей валидны', () => {
    for (const field of data.fields) {
      expect(field.extractHint.length, `${field.key}: пустая подсказка`).toBeGreaterThan(10);
      if (field.pattern) {
        expect(() => new RegExp(field.pattern ?? '')).not.toThrow();
      }
    }
    const cabinet = data.fields.find((field) => field.key === 'cabinet');
    expect(cabinet?.pattern).toBe('^[0-9]{1,4}$');
    expect(cabinet?.ask?.widget).toBe('text');
    expect(data.fields.find((field) => field.key === 'ip')?.type).toBe('ip');
  });
});

describe('справочники data/dictionaries.json', () => {
  it('проходят схему контрактов и не дублируются', () => {
    const parsed = DictionariesFile.parse({ items: data.dictionaries });
    expect(parsed.items.length).toBeGreaterThan(0);
    const keys = data.dictionaries.map((item) => `${item.dictionary}:${item.code}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('закрывают категории, подразделения, приоритеты и каналы', () => {
    expect(dictionaryCodes('category').sort()).toEqual([
      'network',
      'pc',
      'peripheral',
      'printer',
      'server',
      'software',
    ]);
    for (const department of [
      'dep-service',
      'dep-it',
      'dep-network',
      'dep-server',
      'dep-software',
    ]) {
      expect(dictionaryCodes('department')).toContain(department);
    }
    expect(dictionaryCodes('channel').sort()).toEqual(['chat', 'email', 'phone', 'screenshot']);
    expect(dictionaryCodes('impact').sort()).toEqual(['building', 'enterprise', 'group', 'one']);
    expect(dictionaryCodes('urgency').sort()).toEqual(['down', 'planned', 'workaround']);
    expect(dictionaryCodes('building').sort()).toEqual(['А', 'Б', 'В', 'ПРОМ'].sort());
    expect(dictionaryCodes('priority').sort()).toEqual([...PriorityLevel.options].sort());
    expect(dictionaryCodes('serviceType').length).toBeGreaterThanOrEqual(5);
  });

  it('приоритет «авария» помечен как вычисляемый', () => {
    const emergency = data.dictionaries.find(
      (item) => item.dictionary === 'priority' && item.code === 'emergency',
    );
    expect(emergency?.meta).toMatchObject({ computed: true });
  });
});

describe('настройки data/settings.json', () => {
  it('содержат пороги и таймеры уточнений', () => {
    expect(data.settings.confidenceThreshold).toBe(0.75);
    expect(data.settings.massWindowMinutes).toBe(15);
    expect(data.settings.massThreshold).toBe(5);
    expect(data.settings.answerTimeoutMinutes).toBe(30);
    expect(data.settings.maxClarifyRounds).toBe(2);
  });
});

describe('матрица приоритета data/priority-matrix.json', () => {
  it('покрывает все сочетания impact × urgency', () => {
    const impacts = dictionaryCodes('impact');
    const urgencies = dictionaryCodes('urgency');
    expect(Object.keys(data.priorityMatrix.matrix).sort()).toEqual([...impacts].sort());
    for (const impact of impacts) {
      const row = data.priorityMatrix.matrix[impact];
      expect(row, `нет строки для ${impact}`).toBeDefined();
      expect(Object.keys(row ?? {}).sort()).toEqual([...urgencies].sort());
    }
  });

  it('уровни совпадают с контрактом и имеют сроки реакции и решения', () => {
    expect(Object.keys(data.priorityMatrix.levels).sort()).toEqual([...PriorityLevel.options].sort());
    for (const level of PriorityLevel.options) {
      const def = data.priorityMatrix.levels[level];
      expect(def, `нет уровня ${level}`).toBeDefined();
      expect(def?.reactMinutes).toBeGreaterThan(0);
      expect(def?.slaMinutes).toBeGreaterThan(def?.reactMinutes ?? 0);
    }
    for (const row of Object.values(data.priorityMatrix.matrix)) {
      for (const level of Object.values(row)) {
        expect(data.priorityMatrix.levels[level]).toBeDefined();
      }
    }
  });

  it('авария — самый срочный уровень, порядок уровней согласован', () => {
    const levels = data.priorityMatrix.levels;
    const emergency = levels.emergency;
    expect(emergency?.computed).toBe(true);
    for (const level of PriorityLevel.options) {
      if (level === 'emergency') continue;
      expect(emergency?.reactMinutes ?? 0).toBeLessThan(levels[level]?.reactMinutes ?? 0);
      expect(levels[level]?.order ?? 0).toBeGreaterThan(emergency?.order ?? 0);
    }
  });
});

describe('регламент аварий data/emergency-rules.json', () => {
  it('правила ссылаются на существующие чек-листы', () => {
    const checklistIds = data.emergencyRules.checklists.map((checklist) => checklist.id);
    expect(checklistIds.length).toBe(new Set(checklistIds).size);
    for (const rule of data.emergencyRules.rules) {
      expect(checklistIds, `${rule.id}: нет чек-листа ${rule.checklistId}`).toContain(rule.checklistId);
      expect(PriorityLevel.options).toContain(rule.level);
      expect(rule.signs.length).toBeGreaterThan(0);
      expect(rule.patterns.length).toBeGreaterThan(0);
    }
  });

  it('признаки записаны в нижнем регистре и ловят примеры из набора', () => {
    for (const rule of data.emergencyRules.rules) {
      for (const pattern of rule.patterns) {
        expect(pattern, `шаблон «${pattern}» должен быть в нижнем регистре`).toBe(pattern.toLowerCase());
      }
    }
    const fire = data.emergencyRules.rules.find((rule) => rule.id === 'emergency.fire');
    const network = data.emergencyRules.rules.find((rule) => rule.id === 'emergency.network');
    expect(fire?.patterns.some((pattern) => 'искрит и дымит сервер'.includes(pattern))).toBe(true);
    expect(network?.patterns.some((pattern) => 'во всём корпусе В пропала сеть'.includes(pattern))).toBe(
      true,
    );
  });

  it('чек-листы содержат шаги для электрики, воды, пожара и сети', () => {
    const ids = data.emergencyRules.checklists.map((checklist) => checklist.id);
    for (const id of ['fire', 'electric', 'water', 'network']) {
      expect(ids).toContain(id);
    }
    for (const checklist of data.emergencyRules.checklists) {
      expect(checklist.steps.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('CMDB data/cmdb.json', () => {
  it('содержит 4 корпуса и 60–80 единиц оборудования', () => {
    expect(data.cmdb.equipment.length).toBeGreaterThanOrEqual(60);
    expect(data.cmdb.equipment.length).toBeLessThanOrEqual(80);
    expect(data.cmdb.locations.filter((location) => location.kind === 'building')).toHaveLength(4);
    for (const building of ['А', 'Б', 'В', 'ПРОМ']) {
      expect(
        data.cmdb.locations.some(
          (location) =>
            location.kind === 'building' && location.id === buildingLocationId(building),
        ),
      ).toBe(true);
    }
  });

  it('каждое оборудование ссылается на кабинет, этаж и корпус', () => {
    for (const item of data.cmdb.equipment) {
      const cabinetId = `cab-${buildingLocationId(item.building).replace('bld-', '')}-${item.cabinet}`;
      const cabinet = locationById.get(cabinetId);
      expect(cabinet, `${item.id}: нет кабинета ${cabinetId}`).toBeDefined();
      expect(cabinet?.kind).toBe('cabinet');
      const floor = locationById.get(cabinet?.parentId ?? '');
      expect(floor, `${item.id}: нет этажа у ${cabinetId}`).toBeDefined();
      expect(floor?.kind).toBe('floor');
      const building = locationById.get(floor?.parentId ?? '');
      expect(building, `${item.id}: нет корпуса у ${floor?.id}`).toBeDefined();
      expect(building?.kind).toBe('building');
      expect(building?.parentId).toBeNull();
    }
  });

  it('идентификаторы, серийные и инвентарные номера, IP уникальны', () => {
    const ids = data.cmdb.equipment.map((item) => item.id);
    expect(ids.length).toBe(new Set(ids).size);
    const serials = data.cmdb.equipment.map((item) => item.serial).filter(Boolean);
    expect(serials.length).toBe(new Set(serials).size);
    const inventory = data.cmdb.equipment.map((item) => item.inventoryNo).filter(Boolean);
    expect(inventory.length).toBe(new Set(inventory).size);
    const ips = data.cmdb.equipment.map((item) => item.ip).filter(Boolean);
    expect(ips.length).toBe(new Set(ips).size);
    for (const item of data.cmdb.equipment) {
      expect(dictionaryCodes('building')).toContain(item.building);
      expect(dictionaryCodes('equipmentType')).toContain(item.type);
      if (item.ip) expect(item.ip).toMatch(/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/);
    }
  });

  it('пример заказчика есть в CMDB: корпус Б, кабинет 312, принтер HP', () => {
    const printer = data.cmdb.equipment.find((item) => item.id === 'eq-printer-b312');
    expect(printer).toMatchObject({
      type: 'printer',
      model: 'HP LaserJet Pro M404dn',
      building: 'Б',
      cabinet: '312',
      criticality: 'high',
    });
    expect(printer?.serial).toBeTruthy();
    expect(printer?.inventoryNo).toBeTruthy();
    expect(printer?.ip).toBeTruthy();
  });

  it('есть «проблемные» единицы в корпусе Б и на площадке', () => {
    const problem = data.cmdb.equipment.filter((item) => item.criticality === 'high');
    expect(problem.length).toBeGreaterThanOrEqual(3);
    expect(
      data.cmdb.equipment.some(
        (item) => item.building === 'Б' && item.cabinet === '314' && item.type === 'network',
      ),
    ).toBe(true);
    expect(
      data.cmdb.equipment.some(
        (item) => item.building === 'А' && item.cabinet === '104' && item.type === 'mfu',
      ),
    ).toBe(true);
  });
});

describe('специалисты data/engineers.json', () => {
  it('14 специалистов из 5 подразделений', () => {
    expect(data.engineers).toHaveLength(14);
    const ids = data.engineers.map((engineer) => engineer.id);
    expect(ids.length).toBe(new Set(ids).size);
    const departments = new Set(data.engineers.map((engineer) => engineer.departmentId));
    expect(departments.size).toBe(5);
    for (const department of departments) {
      expect(dictionaryCodes('department')).toContain(department);
    }
  });

  it('навыки, корпуса и уровни валидны', () => {
    for (const engineer of data.engineers) {
      expect(dictionaryCodes('level')).toContain(engineer.level);
      expect(engineer.skills.length).toBeGreaterThan(0);
      for (const skill of engineer.skills) {
        expect(skill.level).toBeGreaterThanOrEqual(1);
        expect(skill.level).toBeLessThanOrEqual(5);
      }
      for (const building of engineer.buildings) {
        expect(dictionaryCodes('building')).toContain(building);
      }
      expect(engineer.openTickets).toBeGreaterThanOrEqual(0);
      expect(engineer.resolvedSimilar).toBeGreaterThanOrEqual(0);
    }
  });

  it('на смене 2–3 специалиста, у них разные подразделения', () => {
    const onShift = data.engineers.filter((engineer) => engineer.onShift);
    expect(onShift.length).toBeGreaterThanOrEqual(2);
    expect(onShift.length).toBeLessThanOrEqual(3);
    expect(new Set(onShift.map((engineer) => engineer.departmentId)).size).toBe(onShift.length);
  });
});

describe('пользователи data/users.json', () => {
  it('содержат заявителей, диспетчеров, инженеров, руководителя, админа и гостя', () => {
    expect(data.users.length).toBeGreaterThanOrEqual(35);
    const ids = data.users.map((user) => user.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const user of data.users) {
      expect(Role.options).toContain(user.role);
      if (user.departmentId) expect(dictionaryCodes('department')).toContain(user.departmentId);
    }
    const roles = (role: string): number => data.users.filter((user) => user.role === role).length;
    expect(roles('dispatcher')).toBe(2);
    expect(roles('manager')).toBe(1);
    expect(roles('admin')).toBe(1);
    expect(roles('applicant')).toBeGreaterThanOrEqual(20);
  });

  it('гость без профиля, у заявителей профиль указывает на реальный кабинет и технику', () => {
    const guest = data.users.find((user) => user.id === 'guest');
    expect(guest?.role).toBe('applicant');
    expect(guest?.profile).toBeUndefined();
    for (const user of data.users) {
      if (!user.profile) continue;
      expect(dictionaryCodes('building')).toContain(user.profile.building);
      const cabinetId = `cab-${buildingLocationId(user.profile.building).replace('bld-', '')}-${user.profile.cabinet}`;
      expect(locationById.get(cabinetId)?.kind).toBe('cabinet');
      if (user.profile.equipmentId) {
        expect(equipmentById.has(user.profile.equipmentId), `${user.id}: нет техники`).toBe(true);
      }
    }
  });

  it('у каждого инженера есть пользователь с ролью engineer и совпадающим ФИО', () => {
    for (const engineer of data.engineers) {
      const user = data.users.find((candidate) => candidate.id === engineer.id);
      expect(user, `${engineer.id}: нет пользователя`).toBeDefined();
      expect(user?.role).toBe('engineer');
      expect(user?.fullName).toBe(engineer.fullName);
      expect(user?.departmentId).toBe(engineer.departmentId);
    }
  });
});

describe('база знаний data/kb/*.json', () => {
  it('10 статей с шагами и существующей категорией', () => {
    expect(data.kbArticles).toHaveLength(10);
    const ids = data.kbArticles.map((article) => article.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const article of data.kbArticles) {
      expect(dictionaryCodes('category')).toContain(article.category);
      expect(article.symptoms.length).toBeGreaterThan(0);
      expect(article.steps.length).toBeGreaterThanOrEqual(3);
      expect(article.solution.length).toBeGreaterThan(20);
    }
  });

  it('статья про красный индикатор принтера HP существует', () => {
    const article = data.kbArticles.find((item) => item.id === 'kb-print-red-indicator');
    expect(article?.category).toBe('printer');
    expect(article?.symptoms.join(' ')).toContain('мигает красный индикатор');
  });
});

describe('тестовый набор testset/', () => {
  it('10 обращений с уникальными id и известными каналами', () => {
    expect(CASES).toHaveLength(10);
    expect(new Set(CASES.map((item) => item.data.id)).size).toBe(10);
    expect(CASES.map((item) => item.file.slice(0, 2))).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
    ]);
    for (const { data: testCase } of CASES) {
      expect(dictionaryCodes('channel')).toContain(testCase.channel);
      expect(testCase.text.length).toBeGreaterThan(5);
      expect(testCase.expected).toBeDefined();
      if (testCase.channel === 'phone') expect(testCase.audioFile).toBeTruthy();
    }
  });

  it('эталон ссылается на реестр полей, справочники, статьи и специалистов', () => {
    const fieldKeys = new Set(data.fields.map((field) => field.key));
    for (const { data: testCase } of CASES) {
      for (const [key, value] of Object.entries(testCase.expected.fields)) {
        expect(fieldKeys, `${testCase.id}: поле ${key} не из реестра`).toContain(key);
        if (value === null) continue;
        const field = data.fields.find((candidate) => candidate.key === key);
        if (field?.type === 'dictionary') {
          expect(dictionaryCodes(field.dictionary ?? ''), `${testCase.id}: ${key}=${value}`).toContain(
            value,
          );
        }
      }
      if (testCase.expected.priority) {
        expect(PriorityLevel.options).toContain(testCase.expected.priority);
        expect(dictionaryCodes('priority')).toContain(testCase.expected.priority);
      }
      if (testCase.expected.kbArticle) {
        expect(articleIds).toContain(testCase.expected.kbArticle);
      }
      for (const engineerId of testCase.expected.assigneeTop3 ?? []) {
        expect(engineerById.has(engineerId), `${testCase.id}: нет инженера ${engineerId}`).toBe(true);
      }
    }
  });

  it('в наборе есть 2 неполных обращения без места, 2 аварии, звонок и скриншот', () => {
    const noLocation = CASES.filter(({ data: testCase }) => {
      const { building, cabinet } = testCase.expected.fields;
      return (building ?? null) === null && (cabinet ?? null) === null;
    });
    expect(noLocation.length).toBeGreaterThanOrEqual(2);
    expect(CASES.filter(({ data: testCase }) => testCase.expected.emergency === true)).toHaveLength(2);
    expect(CASES.some(({ data: testCase }) => testCase.channel === 'phone')).toBe(true);
    expect(CASES.some(({ data: testCase }) => testCase.channel === 'screenshot')).toBe(true);
  });

  it('у каждого обращения есть заглушка, проходящая схему AiExtraction', () => {
    const schema = buildAiExtractionSchema(data.fields);
    for (const { stub, data: testCase } of CASES) {
      const raw = STUBS.get(stub);
      expect(raw, `${testCase.id}: нет testset/stubs/${stub}.json`).toBeDefined();
      const parsed = schema.parse(raw) as {
        fields: unknown[];
        aspects: { summary?: { text: string } };
      };
      expect(parsed.fields.length).toBeGreaterThanOrEqual(0);
      expect(parsed.aspects.summary?.text.length).toBeGreaterThan(0);
    }
  });

  it('цитаты заглушки дословно встречаются в тексте обращения', () => {
    for (const { stub, data: testCase } of CASES) {
      const raw = STUBS.get(stub);
      if (!raw) continue;
      const text = normalize(testCase.text);
      for (const field of raw.fields) {
        if (field.quote === null) continue;
        expect(text, `${testCase.id}/${field.key}: цитата «${field.quote}»`).toContain(
          normalize(field.quote),
        );
      }
      for (const sign of raw.aspects.emergency?.signs ?? []) {
        expect(text, `${testCase.id}: цитата признака «${sign.quote}»`).toContain(normalize(sign.quote));
      }
    }
  });

  it('заглушка совпадает с эталоном по найденным полям и признаку аварии', () => {
    for (const { stub, data: testCase } of CASES) {
      const raw = STUBS.get(stub);
      if (!raw) continue;
      const found = new Map(raw.fields.map((field) => [field.key, field.value]));
      for (const [key, value] of Object.entries(testCase.expected.fields)) {
        if (value === null) continue;
        expect(found.get(key), `${testCase.id}: ${key}`).toBe(value);
      }
      expect(raw.aspects.emergency?.suspected).toBe(testCase.expected.emergency === true);
    }
  });
});

describe('buildLocations', () => {
  it('строит корпус и кабинет по оборудованию', () => {
    const locations = buildLocations([
      {
        id: 'eq-x',
        type: 'pc',
        model: 'Test PC',
        building: 'А',
        cabinet: '101',
        criticality: 'low',
      },
    ]);
    expect(locations).toEqual([
      { id: 'bld-a', kind: 'building', name: 'Корпус А', parentId: null },
      { id: 'cab-a-101', kind: 'cabinet', name: 'Каб. 101', parentId: 'bld-a' },
    ]);
  });

  it('не дублирует один и тот же кабинет', () => {
    const locations = buildLocations([
      { id: 'eq-1', type: 'pc', model: 'A', building: 'В', cabinet: '205', criticality: 'low' },
      { id: 'eq-2', type: 'pc', model: 'B', building: 'В', cabinet: '205', criticality: 'high' },
    ]);
    expect(locations).toHaveLength(2);
  });

  it('даёт стабильный id для неизвестного корпуса', () => {
    expect(buildingLocationId('Г')).toBe('bld-г');
  });
});

describe('mergeLocations', () => {
  it('явные локации приоритетнее вычисленных', () => {
    const merged = mergeLocations(data.cmdb.locations, [
      {
        id: 'eq-x',
        type: 'printer',
        model: 'Test',
        building: 'Б',
        cabinet: '312',
        criticality: 'medium',
      },
    ]);
    const cabinets = merged.filter((location) => location.id === 'cab-b-312');
    expect(cabinets).toHaveLength(1);
    expect(cabinets[0]?.parentId).toBe('floor-b-3');
  });

  it('добавляет кабинет из другого корпуса', () => {
    const merged = mergeLocations(data.cmdb.locations, [
      {
        id: 'eq-y',
        type: 'pc',
        model: 'Test',
        building: 'А',
        cabinet: '101',
        criticality: 'low',
      },
    ]);
    expect(merged.some((location) => location.id === 'cab-a-101')).toBe(true);
  });
});
