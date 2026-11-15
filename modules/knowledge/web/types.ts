/** Загрузка данных маршрута: одно состояние на «идёт / ошибка / данные». */
export interface Loadable<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}
