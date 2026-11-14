import type { EmergencyVerdict } from '@ugra/contracts';

/**
 * Данные красного режима карточки заявки. Чистая функция без React: раскладку и цвета
 * задаёт дизайн-система ([ui-design](../../../docs/specs/case9-ui-design.md) — авария
 * только красной точкой/текстом/линией, без красного фона экрана).
 */
export interface EmergencyBannerInput {
  /** Поле заявки `isEmergency` — остаётся, даже если вердикт карточке не отдали. */
  isEmergency?: boolean;
  /** Вердикт модуля `emergency` (`draft.emergency`). */
  emergency?: EmergencyVerdict | null;
  /** Время события `emergency.detected`: «кого уведомили и когда». */
  detectedAt?: string | null;
}

export interface EmergencyBanner {
  tone: 'confirmed' | 'suspected';
  title: string;
  ariaLabel: string;
  signs: EmergencyVerdict['signs'];
  checklist: string[];
  notifiedUserIds: string[];
  at: string | null;
}

/**
 * Баннер `ticket.banner`: нет аварии — `null` (виджет ничего не рисует).
 * Вердикта нет, а заявка помечена аварийной — показываем «под вопросом», без выдуманных признаков.
 */
export function emergencyBanner(
  input: EmergencyBannerInput | null | undefined,
): EmergencyBanner | null {
  const verdict = input?.emergency;
  const level = verdict && verdict.level !== 'none' ? verdict.level : null;

  if (!level && input?.isEmergency !== true) return null;

  const tone = level === 'confirmed' ? 'confirmed' : 'suspected';
  const title = tone === 'confirmed' ? 'АВАРИЯ' : 'АВАРИЯ ПОД ВОПРОСОМ';

  return {
    tone,
    title,
    ariaLabel: tone === 'confirmed' ? 'Авария' : 'Авария под вопросом',
    signs: verdict?.signs ?? [],
    checklist: verdict?.checklist ?? [],
    notifiedUserIds: verdict?.notifyUserIds ?? [],
    at: input?.detectedAt ?? null,
  };
}
