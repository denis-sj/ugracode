import type { FieldValue } from '@ugra/contracts';
import type { Equipment, EquipmentQuery, LocationNode, StepContext } from '@ugra/core';
import { findField, settingNumber } from '@ugra/core';
import { EquipmentCriticality, ExtractionExtras } from '../contracts';
import { fieldValueText, normalizeText, quoteInText, valueProblem } from './rules';

export const GROUND_STEP_ID = 'extraction.ground';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

/** Категория заявки → тип техники в CMDB. Нет пары — фильтр по типу не ставим. */
const EQUIPMENT_TYPE: Record<string, string> = {
  printer: 'printer',
  peripheral: 'peripheral',
  network: 'network',
  server: 'server',
  pc: 'pc',
};

function fieldText(fields: Record<string, FieldValue>, key: string): string | null {
  return fieldValueText(fields[key]?.value);
}

function withTrace(field: FieldValue, entry: FieldValue['trace'][number]): FieldValue {
  return { ...field, trace: [...field.trace, entry] };
}

/** Проверки 1–3 из раздела 5.1: цитата, справочник и формат. Ниже порога — на проверку человеку. */
function groundField(
  field: FieldValue,
  text: string,
  ctx: StepContext,
  threshold: number,
  at: string,
): FieldValue {
  let result = field;
  const value = fieldValueText(field.value);

  if (value !== null && field.origin === 'text' && !quoteInText(text, field.quote?.text ?? '')) {
    result = {
      ...field,
      value: null,
      needsReview: true,
      trace: [
        ...field.trace,
        {
          kind: 'rejected',
          step: GROUND_STEP_ID,
          at,
          note: 'цитаты нет в тексте',
          quote: field.quote?.text,
        },
      ],
    };
  }

  const def = findField(ctx.data, field.key);
  if (result.value !== null && def) {
    const problem = valueProblem(def, String(result.value), ctx.data);
    if (problem) {
      result = {
        ...result,
        value: null,
        needsReview: true,
        trace: [...result.trace, { kind: 'rejected', step: GROUND_STEP_ID, at, note: problem }],
      };
    }
  }

  if (result.value !== null && result.confidence < threshold) {
    result = {
      ...result,
      needsReview: true,
      trace: [
        ...result.trace,
        {
          kind: 'computed',
          step: GROUND_STEP_ID,
          at,
          note: `уверенность ${result.confidence.toFixed(2)} ниже порога ${threshold}`,
        },
      ],
    };
  }

  return result;
}

function equipmentQuery(fields: Record<string, FieldValue>): EquipmentQuery | null {
  const cabinet = fieldText(fields, 'cabinet');
  if (!cabinet) return null;
  const building = fieldText(fields, 'building');
  const model = fieldText(fields, 'model') ?? fieldText(fields, 'equipment');
  const category = fieldText(fields, 'category');
  const query: EquipmentQuery = { cabinet };
  if (building) query.building = building;
  if (model) query.model = model;
  if (category && EQUIPMENT_TYPE[category]) query.type = EQUIPMENT_TYPE[category];
  return query;
}

function cabinetDigits(name: string): string {
  return name.replace(/\D/g, '');
}

/** Кабинет в дереве CMDB: ищем узел под нужным корпусом, иначе любой однозначный. */
export function locationIdFor(
  nodes: readonly LocationNode[],
  building: string | null,
  cabinet: string,
): string | null {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  const inBuilding = (id: string): boolean => {
    if (!building) return true;
    let current: string | null | undefined = id;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const node = nodes.find((item) => item.id === current);
      if (node?.kind === 'building' && normalizeText(node.name).includes(normalizeText(building))) {
        return true;
      }
      current = parents.get(current) ?? null;
    }
    return false;
  };
  const matches = nodes.filter(
    (node) => node.kind === 'cabinet' && cabinetDigits(node.name) === cabinet && inBuilding(node.id),
  );
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}

/** Инвентарный номер и IP — только из CMDB, с `origin: 'cmdb'` и следом `matched_cmdb`. */
function cmdbField(key: string, value: string, at: string, model: string): FieldValue {
  return {
    key,
    value,
    confidence: 1,
    quote: null,
    origin: 'cmdb',
    needsReview: false,
    trace: [{ kind: 'matched_cmdb', step: GROUND_STEP_ID, at, note: `CMDB: ${model}` }],
  };
}

function applyMatch(
  fields: Record<string, FieldValue>,
  equipment: Equipment,
  at: string,
): Record<string, FieldValue> {
  const next = { ...fields };
  if (equipment.inventoryNo && !fieldText(next, 'inventoryNo')) {
    next.inventoryNo = cmdbField('inventoryNo', equipment.inventoryNo, at, equipment.model);
  }
  if (equipment.ip && !fieldText(next, 'ip')) {
    next.ip = cmdbField('ip', equipment.ip, at, equipment.model);
  }
  const anchor = next.equipment ?? next.cabinet;
  if (anchor) {
    next[anchor.key] = withTrace(anchor, {
      kind: 'matched_cmdb',
      step: GROUND_STEP_ID,
      at,
      note: `CMDB: ${equipment.model}, инв. ${equipment.inventoryNo ?? '—'}`,
    });
  }
  return next;
}

function markAmbiguous(
  fields: Record<string, FieldValue>,
  count: number,
  at: string,
): Record<string, FieldValue> {
  const anchor = fields.equipment ?? fields.cabinet;
  if (!anchor) return fields;
  return {
    ...fields,
    [anchor.key]: {
      ...withTrace(anchor, {
        kind: 'matched_cmdb',
        step: GROUND_STEP_ID,
        at,
        note: `CMDB: несколько совпадений (${count}) — выбирает диспетчер`,
      }),
      needsReview: true,
    },
  };
}

interface GroundResult {
  fields: Record<string, FieldValue>;
  cmdb: ExtractionExtras['cmdb'];
}

/**
 * Сверка с CMDB: одно совпадение → инвентарный номер, IP и связки `equipmentId` / `locationId`;
 * несколько → поле на проверку диспетчеру; ни одного → ничего не добавляем.
 */
async function groundCmdb(
  fields: Record<string, FieldValue>,
  ctx: StepContext,
  at: string,
): Promise<GroundResult> {
  const query = equipmentQuery(fields);
  if (!query) return { fields, cmdb: undefined };

  const found = await ctx.ports.cmdb.findEquipment(query);
  if (found.length === 0) return { fields, cmdb: undefined };
  if (found.length > 1) {
    ctx.progress({
      stepId: GROUND_STEP_ID,
      status: 'progress',
      message: `CMDB: несколько совпадений (${found.length}) — нужно уточнение`,
    });
    return { fields: markAmbiguous(fields, found.length, at), cmdb: undefined };
  }

  const equipment = found[0];
  if (!equipment) return { fields, cmdb: undefined };
  const locations = await ctx.ports.cmdb.locations();
  const building = fieldText(fields, 'building');
  const cabinet = fieldText(fields, 'cabinet') ?? equipment.cabinet;
  const criticality = EquipmentCriticality.safeParse(equipment.criticality);
  ctx.progress({
    stepId: GROUND_STEP_ID,
    status: 'progress',
    message: `CMDB: ${equipment.model}, инв. ${equipment.inventoryNo ?? '—'}`,
  });
  return {
    fields: applyMatch(fields, equipment, at),
    cmdb: {
      equipmentId: equipment.id,
      locationId: locationIdFor(locations, building, cabinet),
      criticality: criticality.success ? criticality.data : undefined,
    },
  };
}

/** Шаг `extraction.ground`: проверки кодом после модели и сверка с CMDB. */
export async function groundDraft(ctx: StepContext): Promise<{
  fields: Record<string, FieldValue>;
  extraction: ExtractionExtras;
}> {
  const threshold = settingNumber(ctx.data, 'confidenceThreshold', DEFAULT_CONFIDENCE_THRESHOLD);
  const at = ctx.ports.clock.now().toISOString();
  const text = ctx.draft.sources.map((source) => source.text).join('\n');

  const grounded: Record<string, FieldValue> = {};
  for (const [key, field] of Object.entries(ctx.draft.fields)) {
    grounded[key] = groundField(field, text, ctx, threshold, at);
  }

  const { fields, cmdb } = await groundCmdb(grounded, ctx, at);
  const extraction: ExtractionExtras = { ...readPrevious(ctx.draft.ext.extraction) };
  if (cmdb) {
    extraction.cmdb = cmdb;
  } else {
    delete extraction.cmdb;
  }
  return { fields, extraction };
}

function readPrevious(ext: unknown): ExtractionExtras {
  const parsed = ExtractionExtras.safeParse(ext);
  return parsed.success ? parsed.data : {};
}
