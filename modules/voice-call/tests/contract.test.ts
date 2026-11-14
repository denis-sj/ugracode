import { describe, expect, it } from 'vitest';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import voiceCall from '../server';

describe('тест-контракт модуля voice-call', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(voiceCall, { readmePath: 'modules/voice-call/README.md' });
  });

  it('шагов пайплайна у модуля нет: разбор обращения не меняется', async () => {
    expect(voiceCall.steps).toHaveLength(0);
    const { draft } = await runModuleContract({ modules: [voiceCall] });
    expect(draft).toBeDefined();
  });
});
