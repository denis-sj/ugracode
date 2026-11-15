import type { JSX } from 'react';
import { Button, SearchField } from '@ugra/ui';

/** Примеры запросов: это подсказка интерфейса, а не данные — чисел и имён здесь нет. */
const SUGGESTIONS = ['принтер не печатает', 'замятие бумаги', 'VPN не подключается'] as const;

interface SearchHeroProps {
  query: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

/** Крупный поиск сверху: один вопрос «Что сломалось?» и одно поле. */
export function SearchHero({ query, busy, onChange, onSubmit }: SearchHeroProps): JSX.Element {
  return (
    <header className="kb-hero" data-reveal>
      <h1 className="kb-hero__title">Что сломалось?</h1>

      <form
        className="kb-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <SearchField
          className="kb-search__field"
          value={query}
          label="Поиск по базе знаний"
          placeholder="принтер мигает красным и не печатает"
          onChange={onChange}
        />
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          Найти
        </Button>
      </form>

      <div className="kb-sugg" role="group" aria-label="Примеры запросов">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="kb-sugg__chip"
            onClick={() => onChange(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </header>
  );
}
