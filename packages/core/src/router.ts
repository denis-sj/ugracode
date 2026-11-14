import type { z } from 'zod';
import type { Permission } from '@ugra/contracts';
import type { ModuleHandler, RouteSchemas } from './module';

export interface ModuleRouteInput {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Путь относительно `/api/m/<id>`. */
  path: string;
  access: Permission;
  body?: z.ZodType;
  response?: z.ZodType;
  handler: ModuleHandler;
}

/** Собирает маршруты модуля; сервер монтирует их под `/api/m/<id>/…` с проверкой права. */
export class RouteCollector {
  private readonly routes: ModuleRouteInput[] = [];

  add(route: ModuleRouteInput): void {
    if (!route.path.startsWith('/')) {
      throw new Error(`Путь маршрута модуля должен начинаться с "/": ${route.path}`);
    }
    this.routes.push(route);
  }

  get(path: string, access: Permission, handler: ModuleHandler, schemas: RouteSchemas = {}): void {
    this.add({ method: 'GET', path, access, handler, ...schemas });
  }

  post(path: string, access: Permission, handler: ModuleHandler, schemas: RouteSchemas = {}): void {
    this.add({ method: 'POST', path, access, handler, ...schemas });
  }

  patch(path: string, access: Permission, handler: ModuleHandler, schemas: RouteSchemas = {}): void {
    this.add({ method: 'PATCH', path, access, handler, ...schemas });
  }

  list(): readonly ModuleRouteInput[] {
    return this.routes;
  }
}
