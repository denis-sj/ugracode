# Модуль `applicant-profile`

Что делает: шаг `profile.prefill` (стадия `validate`, `order 150`) подставляет в пустые поля место работы заявителя из профиля (`building`, `floor`, `cabinet` — `origin: profile`, уверенность 0,8, след `from_profile`) и, если в тексте назван тип техники, единственную подходящую единицу из CMDB по корпусу и кабинету (`equipment`, `model`, `inventoryNo`, `ip`).
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=applicant-profile` (подставлять будет нечего, вопросы задаются обо всём).
Точки расширения: `steps` (`profile.prefill`, `reads: ['fields']`, `writes: ['fields']`), таблицы `applicant_profile` и `applicant_equipment` (сид из `data/users.json`), `KernelStore` — `getApplicantProfile` / `saveApplicantProfile` / `listApplicantEquipment`.
Текст обращения главнее профиля: заполненное поле не трогается, несколько единиц техники одного типа — не угадываются.
Момент демо: заявитель из каб. 312 пишет «принтер не печатает» — корпус, этаж, кабинет и HP LaserJet подставлены со значком 👤; гость `guest` без профиля получает вопросы обо всём.
