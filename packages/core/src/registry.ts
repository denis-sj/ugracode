import type { z } from 'zod';
import type { EventBus, EventDef, FieldDef } from '@ugra/contracts';
import type { ModuleDeps, ServerModule } from './module';
import type { PipelineStep } from './types';
import type { ReportDef } from './reports';
import type { ModuleRouteInput } from './router';

export interface Registries {
  modules: ServerModule[];
  fields: FieldDef[];
  steps: PipelineStep[];
  aspects: Record<string, z.ZodType>;
  reports: ReportDef[];
  events: EventDef[];
}

/**
 * Собирает реестры из манифеста модулей. Дубликаты — ошибка запуска, а не тихая перезапись.
 */
export function buildRegistries(modules: readonly ServerModule[], baseFields: readonly FieldDef[] = []): Registries {
  const ids = new Set<string>();
  const fieldKeys = new Set<string>();
  const stepIds = new Set<string>();
  const fields: FieldDef[] = [];
  const steps: PipelineStep[] = [];
  const reports: ReportDef[] = [];
  const events: EventDef[] = [];
  const aspects: Record<string, z.ZodType> = {};

  const addField = (field: FieldDef): void => {
    if (fieldKeys.has(field.key)) throw new Error(`Поле ${field.key} объявлено дважды`);
    fieldKeys.add(field.key);
    fields.push(field);
  };

  baseFields.forEach(addField);
  for (const module of modules) {
    if (ids.has(module.id)) throw new Error(`Модуль ${module.id} зарегистрирован дважды`);
    ids.add(module.id);
    module.fields.forEach(addField);
    for (const step of module.steps) {
      if (stepIds.has(step.id)) throw new Error(`Шаг ${step.id} объявлен дважды`);
      stepIds.add(step.id);
      steps.push(step);
    }
    for (const [key, schema] of Object.entries(module.aspects)) {
      if (aspects[key]) throw new Error(`Аспект ${key} объявлен дважды`);
      aspects[key] = schema;
    }
    reports.push(...module.reports);
    for (const event of module.events) {
      if (!event.type.startsWith(`${module.id}.`)) {
        throw new Error(`Событие ${event.type} должно начинаться с префикса ${module.id}.`);
      }
      events.push(event);
    }
  }
  return { modules: [...modules], fields, steps, aspects, reports, events };
}

export interface MountedRoutes {
  moduleId: string;
  routes: readonly ModuleRouteInput[];
}

/** Вызывает `routes()` каждого модуля и возвращает собранные маршруты для монтирования под `/api/m/<id>`. */
export function collectRoutes(modules: readonly ServerModule[], deps: ModuleDeps): MountedRoutes[] {
  const mounted: MountedRoutes[] = [];
  for (const module of modules) {
    if (!module.routes) continue;
    const routes: ModuleRouteInput[] = [];
    module.routes(
      {
        add: (route) => routes.push(route),
        get: (path, access, handler, schemas = {}) =>
          routes.push({ method: 'GET', path, access, handler, ...schemas }),
        post: (path, access, handler, schemas = {}) =>
          routes.push({ method: 'POST', path, access, handler, ...schemas }),
        patch: (path, access, handler, schemas = {}) =>
          routes.push({ method: 'PATCH', path, access, handler, ...schemas }),
      },
      deps,
    );
    mounted.push({ moduleId: module.id, routes });
  }
  return mounted;
}

/** Подписывает обработчики модулей. Ошибки подписчиков шина изолирует. */
export function subscribeModules(modules: readonly ServerModule[], bus: EventBus, deps: ModuleDeps): void {
  for (const module of modules) {
    for (const subscriber of module.subscribers) {
      bus.subscribe(subscriber.on, async (event) => {
        await subscriber.handle(event, deps);
      });
    }
  }
}
