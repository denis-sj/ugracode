/** Подписи задачи для списка: название и место приходят из полей заявки, а не из списка API. */
export interface TaskPreview {
  title: string;
  place: string;
  equipment: string;
}

/** Загрузка данных маршрута: одно состояние на «идёт / ошибка / данные». */
export interface Loadable<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}
