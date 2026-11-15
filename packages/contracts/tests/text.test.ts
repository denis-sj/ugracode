import { describe, expect, it } from 'vitest';
import { groupThousands, trimChars, trimEndChars, trimStartChars } from '../src/text';

describe('trimEndChars', () => {
  it('убирает хвост из символов набора', () => {
    expect(trimEndChars('/chat///', '/')).toBe('/chat');
  });
  it('строка целиком из набора становится пустой', () => {
    expect(trimEndChars('////', '/')).toBe('');
  });
  it('без хвоста строка не меняется', () => {
    expect(trimEndChars('abc', '/')).toBe('abc');
  });
  it('линейна на длинном вводе', () => {
    const long = `${'/'.repeat(200_000)}x`;
    expect(trimEndChars(long, '/')).toBe(long);
  });
});

describe('trimStartChars и trimChars', () => {
  it('убирает символы набора в начале', () => {
    expect(trimStartChars('«  текст', '« ')).toBe('текст');
  });
  it('пустая строка остаётся пустой', () => {
    expect(trimStartChars('', ' ')).toBe('');
  });
  it('trimChars убирает с обоих концов', () => {
    expect(trimChars(' «принтер не печатает»! ', ' «»!')).toBe('принтер не печатает');
  });
});

describe('groupThousands', () => {
  it('группирует по три с конца', () => {
    expect(groupThousands('1234567', ' ')).toBe('1 234 567');
  });
  it('короткое число не трогает', () => {
    expect(groupThousands('999', ' ')).toBe('999');
  });
  it('ровно четыре цифры', () => {
    expect(groupThousands('1000', ' ')).toBe('1 000');
  });
  it('пустая строка', () => {
    expect(groupThousands('', ' ')).toBe('');
  });
});
