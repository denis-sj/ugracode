# Модуль `extraction`

Что делает: агент `intake` разбирает обращение инструментами (`dictionary_lookup`, `cmdb_*`), сдаёт поля с цитатами, признаки аварии и вопрос заявителю; шаг `extraction.ground` кодом проверяет цитаты, справочники, `pattern` и сверяет технику с CMDB (инвентарный номер, IP, `equipmentId`/`locationId`).
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=extraction` (шагов и агента в разборе не будет).
Точки расширения: `agents` (`intake`, промпт `prompts/intake.v2.md`, `submit` и `check()` в `server/intake.ts`), `steps` (`agent.intake` — стадия `extract`, `extraction.ground` — стадия `validate`), `evaluate` шага (точность по полям эталона), данные модуля — `draft.ext.extraction` (`summary`, `questions` — план вопросов по важности, `clarify` — первый из них, `emergency`, `cmdb`).
Момент демо: «корпус Б, каб. 312, принтер HP, мигает красный индикатор» — в интерфейсе поля появляются по одному, у каждого видна цитата, инвентарный номер приходит из CMDB; «опять ничего не работает» не даёт выдуманных полей.
