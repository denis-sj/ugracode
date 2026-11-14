import { describe, expect, it } from 'vitest';
import type { EmergencyVerdict } from '@ugra/contracts';
import { emergencyBanner } from '../web/banner';

function verdict(patch: Partial<EmergencyVerdict> = {}): EmergencyVerdict {
  return {
    level: 'confirmed',
    signs: [{ sign: 'smoke', quote: 'идёт дым' }],
    confidence: 0.95,
    rulesMatched: ['emergency.fire'],
    checklist: ['Обесточьте оборудование.'],
    notifyUserIds: ['u-network'],
    ...patch,
  };
}

describe('emergency: баннер карточки', () => {
  it('подтверждённая авария — красный режим с признаками и чек-листом', () => {
    const banner = emergencyBanner({ emergency: verdict(), detectedAt: '2026-11-14T10:00:00.000Z' });

    expect(banner).toEqual({
      tone: 'confirmed',
      title: 'АВАРИЯ',
      ariaLabel: 'Авария',
      signs: [{ sign: 'smoke', quote: 'идёт дым' }],
      checklist: ['Обесточьте оборудование.'],
      notifiedUserIds: ['u-network'],
      at: '2026-11-14T10:00:00.000Z',
    });
  });

  it('под вопросом — другой заголовок', () => {
    const banner = emergencyBanner({ emergency: verdict({ level: 'suspected' }) });

    expect(banner?.tone).toBe('suspected');
    expect(banner?.title).toBe('АВАРИЯ ПОД ВОПРОСОМ');
    expect(banner?.at).toBeNull();
  });

  it('аварии нет — баннера нет', () => {
    expect(emergencyBanner({ emergency: verdict({ level: 'none' }) })).toBeNull();
    expect(emergencyBanner({ isEmergency: false })).toBeNull();
    expect(emergencyBanner(null)).toBeNull();
  });

  it('вердикта нет, но заявка помечена аварийной — «под вопросом» без выдуманных признаков', () => {
    const banner = emergencyBanner({ isEmergency: true });

    expect(banner?.tone).toBe('suspected');
    expect(banner?.signs).toEqual([]);
    expect(banner?.checklist).toEqual([]);
  });
});
