import { describe, expect, it } from 'vitest';
import {
  GREETING,
  LINE_SILENCE,
  MAX_CALL_SECONDS,
  MIC_DENIED_NOTE,
  TEXT_NOTE,
  VOICE_NOTE,
  appendLine,
  detectDevice,
  isCallPath,
  modeNote,
  phaseLabel,
  pickRussianVoice,
  shouldAutoFinish,
  ticketLabel,
  timerText,
} from '../web/call-flow';

describe('страница звонка: подписи и арифметика', () => {
  it('узнаёт устройство звонящего по userAgent', () => {
    expect(detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
    expect(detectDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad');
    expect(detectDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('Android');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('Компьютер');
    expect(detectDevice('')).toBe('Телефон');
  });

  it('таймер разговора — «м:сс», мусор превращается в 0:00', () => {
    expect(timerText(0)).toBe('0:00');
    expect(timerText(9)).toBe('0:09');
    expect(timerText(65)).toBe('1:05');
    expect(timerText(-5)).toBe('0:00');
    expect(timerText(Number.NaN)).toBe('0:00');
  });

  it('страница /call открывается и по пути, и по hash', () => {
    expect(isCallPath('/call', '')).toBe(true);
    expect(isCallPath('/call/', '')).toBe(true);
    expect(isCallPath('/', '#/call')).toBe(true);
    expect(isCallPath('/', '#/call?from=qr')).toBe(true);
    expect(isCallPath('/', '#/calls')).toBe(false);
    expect(isCallPath('/calls', '')).toBe(false);
    expect(isCallPath('/', '')).toBe(false);
  });

  it('выбирает русский голос синтеза, а без него — пусто', () => {
    const voices = [
      { lang: 'en-US', name: 'Samantha' },
      { lang: 'ru-RU', name: 'Milena' },
      { lang: 'ru-RU', name: 'Yuri' },
    ];
    expect(pickRussianVoice(voices)?.name).toBe('Milena');
    expect(pickRussianVoice([{ lang: 'en-US' }])).toBeNull();
    expect(pickRussianVoice([])).toBeNull();
  });

  it('добавляет реплику, схлопывает пробелы и показывает тишину', () => {
    expect(appendLine([], 'caller', '  не  печатает \n принтер ')).toEqual([
      { speaker: 'caller', text: 'не печатает принтер' },
    ]);
    expect(appendLine([], 'caller', '   ')).toEqual([{ speaker: 'caller', text: LINE_SILENCE }]);
  });

  it('подписывает каждую фазу разговора', () => {
    expect(phaseLabel('incoming')).toBe('Входящий вызов');
    expect(phaseLabel('listening')).toBe('Слушаю…');
    expect(phaseLabel('thinking')).toBe('Секунду, записываю…');
    expect(phaseLabel('ended')).toBe('Звонок завершён');
  });

  it('поясняет режим ввода одной строкой', () => {
    expect(modeNote('voice', false)).toBe(VOICE_NOTE);
    expect(modeNote('text', false)).toBe(TEXT_NOTE);
    expect(modeNote('text', true)).toBe(MIC_DENIED_NOTE);
  });

  it('предупреждает о лимите 90 секунд и номере заявки', () => {
    expect(MAX_CALL_SECONDS).toBe(90);
    expect(shouldAutoFinish(89)).toBe(false);
    expect(shouldAutoFinish(90)).toBe(true);
    expect(ticketLabel('З-20261114-0001')).toBe('З-20261114-0001');
    expect(ticketLabel(null)).toBe('без номера');
    expect(GREETING).toContain('ИИ');
  });
});
