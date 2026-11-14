import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { MetaResponse } from '@ugra/contracts';
import { describeMeta } from './meta';
import { webModules } from './web-modules';

type MetaState =
  | { status: 'loading' }
  | { status: 'ok'; meta: MetaResponse }
  | { status: 'error'; message: string };

const TOPBAR_SLOT = 'shell.topbar';

async function loadMeta(): Promise<MetaResponse> {
  const response = await fetch('/api/meta', {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as MetaResponse;
}

export function App(): JSX.Element {
  const [state, setState] = useState<MetaState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;

    loadMeta()
      .then((meta) => {
        if (alive) {
          setState({ status: 'ok', meta });
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  const topbarWidgets = webModules.flatMap((module) =>
    module.widgets
      .filter((widget) => widget.slot === TOPBAR_SLOT)
      .map((widget) => ({ moduleId: module.id, widget })),
  );

  const pages = webModules.flatMap((module) =>
    module.pages.map((page) => ({ moduleId: module.id, page })),
  );

  return (
    <main>
      <h1>Диспетчерская с ИИ</h1>

      {state.status === 'loading' && <p className="muted">Загружаем метаданные…</p>}

      {state.status === 'error' && (
        <section className="panel">
          <p className="status-error">API не отвечает</p>
          <p className="muted">Детали: {state.message}</p>
        </section>
      )}

      {state.status === 'ok' && (
        <section className="panel">
          <p className="status-ok">Каркас работает</p>
          <p className="muted">{describeMeta(state.meta)}</p>

          <div className="row">
            {state.meta.modules.map((module) => (
              <span className="badge" key={module.id}>
                {module.id} — {module.title}
              </span>
            ))}
            {state.meta.modules.length === 0 && <span className="muted">Модулей нет</span>}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Верхняя панель</h2>
        <div className="row">
          {topbarWidgets.map(({ moduleId, widget }) => (
            <span className="badge" key={`${moduleId}:${widget.id}`}>
              {widget.id}
            </span>
          ))}
          {topbarWidgets.length === 0 && <span className="muted">Виджетов нет</span>}
        </div>
      </section>

      <section className="panel">
        <h2>Страницы модулей</h2>
        {pages.length === 0 && <p className="muted">Страниц нет</p>}
        {pages.length > 0 && (
          <ul>
            {pages.map(({ moduleId, page }) => (
              <li key={`${moduleId}:${page.path}`}>
                <code>{page.path}</code> — {page.title} <span className="muted">({moduleId})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
