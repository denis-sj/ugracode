import type { MetaResponse, User } from '@ugra/contracts';
import type { JSX } from 'react';
import { Badge, Button, Card, Slot, StatTile, Timeline } from '@ugra/ui';
import type { SlotWidget, TimelineItem } from '@ugra/ui';
import { greeting, type MenuItem, ROLE_LABELS } from '../lib';
const PIPELINE_ITEMS: TimelineItem[] = [
  {
    id: 'intake',
    title: 'Читаем обращение',
    description: 'Текст, звонок или скриншот превращаются в источники разбора',
    tone: 'accent',
  },
  {
    id: 'extract',
    title: 'Извлекаем поля',
    description: 'Модель предлагает значения, код проверяет цитаты, справочники и CMDB',
    tone: 'accent',
  },
  {
    id: 'clarify',
    title: 'Спрашиваем, чего не хватает',
    description: 'Вопрос-карточка уходит заявителю — без лимита и с кнопкой «Не знаю»',
    tone: 'warn',
  },
  {
    id: 'assess',
    title: 'Оцениваем аварию и приоритет',
    description: 'Правила регламента + мнение модели, матрица «влияние × срочность»',
    tone: 'danger',
  },
  {
    id: 'route',
    title: 'Подбираем исполнителя',
    description: 'Топ-3 инженера с объяснением: навык, смена, загрузка, похожие заявки',
    tone: 'ok',
  },
  {
    id: 'finalize',
    title: 'Отдаём диспетчеру',
    description: 'Карточка с уверенностью, цитатами и следом каждого поля',
    tone: 'ok',
  },
];

export interface HomeScreenProps {
  user: User;
  meta: MetaResponse;
  menu: readonly MenuItem[];
  widgets: readonly SlotWidget[];
  actions: number;
}

/** Стартовый экран после входа: показатели, маршруты и как устроен разбор. */
export function HomeScreen({ user, meta, menu, widgets, actions }: HomeScreenProps): JSX.Element {
  const firstName = user.fullName.split(' ')[1] ?? user.fullName;

  return (
    <div className="home ugra-fade">
      <section className="home__intro">
        <div>
          <p className="home__kicker">
            {greeting()}, {firstName}
          </p>
          <h1 className="home__title">Диспетчерская с ИИ</h1>
          <p className="home__lead ugra-muted">
            Вы вошли как {ROLE_LABELS[user.role].toLowerCase()}. Включено модулей: {meta.modules.length}, полей в
            реестре: {meta.fields.length}.
          </p>
        </div>
        <div className="home__badges">
          {meta.priorities.map((priority) => (
            <Badge tone={priority} key={priority}>
              {priority}
            </Badge>
          ))}
        </div>
      </section>

      <section className="home__stats">
        <StatTile label="Модулей" value={meta.modules.length} hint="включены через флаги фич" tone="accent" icon="◇" />
        <StatTile label="Полей" value={meta.fields.length} hint="реестр полей и вопросов" tone="accent" icon="▤" />
        <StatTile label="Действий" value={actions} hint="счётчик для замера К4" tone="ok" icon="✦" />
        <StatTile
          label="Справочников"
          value={meta.dictionaries.length}
          hint="значения для полей и вопросов"
          tone="accent"
          icon="≡"
        />
      </section>

      <Slot name="dashboard.tiles" widgets={widgets} role={user.role} context={{ user, meta, actions }} />

      <section className="home__grid">
        <Card className="home__routes" hero>
          <h2>С чего начать</h2>
          <p className="ugra-muted">Каждый экран — страница веб-модуля из реестра. Меню собирается по роли.</p>
          <div className="home__route-list">
            {menu.length === 0 && <p className="ugra-muted">Для вашей роли пока нет страниц.</p>}
            {menu.map((item) => (
              <a className="home__route" href={`#${item.path}`} key={item.id}>
                <span className="home__route-icon" aria-hidden="true">
                  {item.icon ?? '→'}
                </span>
                <span className="home__route-body">
                  <span className="home__route-title">{item.title}</span>
                  <span className="home__route-path">{item.path}</span>
                </span>
                <span className="home__route-section">{item.section}</span>
              </a>
            ))}
          </div>
        </Card>

        <Card className="home__pipeline">
          <h2>Как идёт разбор</h2>
          <p className="ugra-muted">Шаги пайплайна видны заявителю вживую, а диспетчеру — в журнале заявки.</p>
          <Timeline items={PIPELINE_ITEMS} className="home__timeline" />
        </Card>
      </section>

      <Slot name="dashboard.main" widgets={widgets} role={user.role} context={{ user, meta, actions }} />

      <Card className="home__modules" glass>
        <div className="home__modules-head">
          <h2>Включённые модули</h2>
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
            Обновить
          </Button>
        </div>
        <div className="ugra-row">
          {meta.modules.map((module) => (
            <Badge tone="accent" key={module.id}>
              {module.id} · {module.title}
            </Badge>
          ))}
          {meta.modules.length === 0 && <span className="ugra-muted">Модулей нет — включите фичи в `.env`.</span>}
        </div>
      </Card>
    </div>
  );
}
