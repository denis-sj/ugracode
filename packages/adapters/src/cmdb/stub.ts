import { z } from 'zod';
import type {
  CmdbPort,
  Equipment,
  EquipmentQuery,
  LocationNode,
} from '@ugra/core';

export const DEFAULT_EQUIPMENT: readonly Equipment[] = [
  {
    id: 'eq-printer-312',
    type: 'printer',
    model: 'HP LaserJet Pro M404dn',
    serial: 'VNB3K12345',
    inventoryNo: 'INV-000312',
    // Адрес из диапазона для документации (RFC 5737): заглушка не должна указывать на реальную сеть.
    ip: '192.0.2.12',
    building: 'Б',
    cabinet: '312',
    criticality: 'high',
  },
];

const EquipmentSchema = z.object({
  id: z.string(),
  type: z.string(),
  model: z.string(),
  serial: z.string().nullable().default(null),
  inventoryNo: z.string().nullable().default(null),
  ip: z.string().nullable().default(null),
  building: z.string(),
  cabinet: z.string(),
  criticality: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

/**
 * Разбор оборудования из `data/cmdb.json`: файл — объект `{ locations, equipment }`,
 * старый формат — просто массив. Оба понимаем, иначе API молча уходит на запасную CMDB.
 */
export function parseEquipment(raw: unknown): Equipment[] {
  const list =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { equipment?: unknown }).equipment : raw;
  return z.array(EquipmentSchema).parse(list);
}

function floorOf(cabinet: string): string {
  const first = cabinet.trim().charAt(0);
  return /[0-9]/.test(first) ? first : '1';
}

function matches(value: string | null, query: string): boolean {
  return value !== null && value.toLowerCase().includes(query);
}

/** CMDB поверх массива оборудования; локации строятся из данных. */
export class StubCmdb implements CmdbPort {
  private readonly items: readonly Equipment[];

  constructor(items: readonly Equipment[] = DEFAULT_EQUIPMENT) {
    this.items = items;
  }

  async findEquipment(query: EquipmentQuery): Promise<Equipment[]> {
    return this.items.filter((item) => {
      if (query.building && !matches(item.building, query.building.toLowerCase())) return false;
      if (query.cabinet && !matches(item.cabinet, query.cabinet.toLowerCase())) return false;
      if (query.type && !matches(item.type, query.type.toLowerCase())) return false;
      if (query.model && !matches(item.model, query.model.toLowerCase())) return false;
      if (query.serial && !matches(item.serial, query.serial.toLowerCase())) return false;
      if (query.inventoryNo && !matches(item.inventoryNo, query.inventoryNo.toLowerCase())) {
        return false;
      }
      if (query.ip && !matches(item.ip, query.ip.toLowerCase())) return false;
      if (query.text) {
        const haystack = [
          item.type,
          item.model,
          item.serial,
          item.inventoryNo,
          item.ip,
          item.building,
          item.cabinet,
        ]
          .filter((part): part is string => typeof part === 'string')
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query.text.toLowerCase())) return false;
      }
      return true;
    });
  }

  async locations(): Promise<LocationNode[]> {
    const nodes = new Map<string, LocationNode>();

    for (const item of this.items) {
      const buildingId = `building:${item.building}`;
      if (!nodes.has(buildingId)) {
        nodes.set(buildingId, {
          id: buildingId,
          kind: 'building',
          name: item.building,
          parentId: null,
        });
      }

      const floor = floorOf(item.cabinet);
      const floorId = `${buildingId}/floor:${floor}`;
      if (!nodes.has(floorId)) {
        nodes.set(floorId, {
          id: floorId,
          kind: 'floor',
          name: `${floor} этаж`,
          parentId: buildingId,
        });
      }

      const cabinetId = `${floorId}/cabinet:${item.cabinet}`;
      if (!nodes.has(cabinetId)) {
        nodes.set(cabinetId, {
          id: cabinetId,
          kind: 'cabinet',
          name: `каб. ${item.cabinet}`,
          parentId: floorId,
        });
      }
    }

    return [...nodes.values()];
  }
}
