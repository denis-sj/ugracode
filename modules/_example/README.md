# Модуль `example`

Что делает: образец модуля — шаг разбора правилами, подписчик и маршрут.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=example`.
Точки расширения: `steps` (`example.extract`), `subscribers` (`ticket.confirmed`), `routes` (`GET /api/m/example/ping`).
Момент демо: показывает, как из текста появляются поля без модели; используется сквозным тестом.
