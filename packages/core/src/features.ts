import type { ServerModule } from './module';

export interface FeatureFlagsEnv {
  FEATURES_OFF?: string;
  FEATURES_ON?: string;
}

export function parseModuleList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Флаги фич: `enabledByDefault` + переопределение `FEATURES_OFF` / `FEATURES_ON` (раздел 3.7). */
export function isModuleEnabled(module: ServerModule, env: FeatureFlagsEnv): boolean {
  const on = parseModuleList(env.FEATURES_ON);
  const off = parseModuleList(env.FEATURES_OFF);
  if (on.includes(module.id)) return true;
  if (off.includes(module.id)) return false;
  return module.enabledByDefault;
}

export function resolveEnabledModules(
  modules: readonly ServerModule[],
  env: FeatureFlagsEnv,
): { enabled: ServerModule[]; disabled: string[] } {
  const enabled: ServerModule[] = [];
  const disabled: string[] = [];
  for (const module of modules) {
    if (isModuleEnabled(module, env)) enabled.push(module);
    else disabled.push(module.id);
  }
  return { enabled, disabled };
}
