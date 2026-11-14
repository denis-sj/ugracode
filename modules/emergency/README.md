# Модуль `emergency`

Что делает: шаг `emergency.detect` ищет признаки аварии в тексте обращения правилами из `data/emergency-rules.json` и сверяет с мнением агента `intake` (`draft.ext.extraction.emergency`); оба сигнала → «подтверждена», один → «под вопросом», ни одного → обычная заявка.
При сигнале: вердикт в `draft.emergency` (уровень, признаки с цитатами, чек-лист, дежурные), событие `emergency.detected` и уведомление дежурным на смене (`data/engineers.json`, навык правила).
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=emergency` (шага нет, поле `emergency` остаётся пустым).
Точки расширения: `steps` (`emergency.detect` — стадия `assess`, `order 100`, `reads: sources, fields, ext`, `writes: emergency`), `events` (`emergency.detected`), метрика `emergency_match`; веб-виджет `emergency.banner` в слоте `ticket.banner` (`modules/emergency/web`).
Момент демо: «не печатает принтер, и идёт дым» → плашка «АВАРИЯ ПОД ВОПРОСОМ», чек-лист и уведомление дежурным; «принтер не печатает» → аварии нет.
