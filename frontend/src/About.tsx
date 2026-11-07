// Редакционный текст content manager; ID соответствуют каталогу 002_catalog.sql.
const directions = [
  {
    id: 1,
    title: "Распознавание эмоций по лицу",
    methods: "MediaPipe Face · FER-модели",
    description:
      "Изучаем модели представления эмоций, методы выделения ключевых точек лица и архитектуры классификаторов выражений лица. Анализируем совместное использование MediaPipe Face и FER-моделей, их возможности и ограничения при оценке эмоциональных проявлений по изображению.",
  },
  {
    id: 2,
    title: "Распознавание динамических жестов",
    methods: "MediaPipe Hands",
    description:
      "Исследуем статические и динамические жесты в человеко-машинном взаимодействии, отслеживание ключевых точек кисти и классификацию движений во времени. Рассматриваем жест как последовательность изменений положения руки.",
  },
  {
    id: 3,
    title: "Мультимодальная фузия",
    methods: "Объединение мимики и жестов",
    description:
      "Сопоставляем раннюю, позднюю и гибридную фузию, способы синхронизации потоков и разрешения противоречий между каналами. Выясняем, при каких условиях объединение мимических и жестовых сигналов может улучшить оценку состояния человека.",
  },
  {
    id: 4,
    title: "Динамика состояний и поведения",
    methods: "Трекинг · анализ во времени",
    description:
      "Изучаем нестабильность покадрового распознавания, методы фильтрации и сглаживания оценок, отслеживание переходов между состояниями. Анализируем изменения невербального поведения человека в ходе диалога.",
  },
  {
    id: 5,
    title: "Адаптация поведения роботов",
    methods: "ROS 2 · IoT-устройства",
    description:
      "Исследуем подходы к использованию эмоциональных и жестовых сигналов в человеко-роботном взаимодействии. Рассматриваем архитектуру ROS 2-узла распознавания и сценарии адаптации поведения робота и IoT-инфраструктуры к состоянию человека.",
  },
];

const team = [
  {
    name: "Егор Мушкетов",
    initials: "Мушкетов Е. В.",
    role: "Руководитель проекта",
    responsibility: "Координация работы команды.",
    research: "Адаптация поведения роботов, ROS 2 и IoT-устройства.",
  },
  {
    name: "Екатерина Кондратьева",
    initials: "Кондратьева Е. А.",
    role: "Контент-менеджер",
    responsibility:
      "Структура каталога, схемы интерфейса и оформление материалов.",
    research: "Мультимодальная фузия мимики и жестов.",
  },
  {
    name: "Фёдор Маврин",
    initials: "Маврин Ф. М.",
    role: "Разработчик сайта",
    responsibility: "Сайт, данные и API.",
    research: "Распознавание эмоций по лицу: MediaPipe Face и FER-модели.",
  },
  {
    name: "Александр Комаров",
    initials: "Комаров А. С.",
    role: "Разработчик бота",
    responsibility: "Модуль обращения к языковой модели.",
    research: "Распознавание динамических жестов: MediaPipe Hands.",
  },
  {
    name: "Андрей Воропаев",
    initials: "Воропаев А. К.",
    role: "Тестировщик",
    responsibility: "Проверка работы сайта и пользовательских сценариев.",
    research: "Трекинг динамики состояний и анализ поведения во времени.",
  },
];

export function About() {
  return (
    <article className="about-page">
      <section className="about-intro" aria-labelledby="about-title">
        <div>
          <p className="eyebrow">О ПРОЕКТЕ / НИР18</p>
          <h1 id="about-title">
            Учимся понимать
            <br />
            <span>человека.</span>
          </h1>
          <p className="about-university">
            Студенческая команда Национального исследовательского университета
            «МЭИ».
          </p>
        </div>
        <div className="about-topic">
          <p className="eyebrow">ТЕМА ИССЛЕДОВАНИЯ</p>
          <p>
            Методы мультимодального распознавания аффективных состояний и
            динамических жестов с использованием MediaPipe и FER-моделей.
          </p>
          <div className="about-signals" aria-hidden="true">
            <span>Мимика</span>
            <i>+</i>
            <span>Жесты</span>
            <i>+</i>
            <span>Время</span>
          </div>
        </div>
      </section>

      <nav className="about-nav" aria-label="Разделы страницы о проекте">
        <a href="#purpose">01 / Зачем исследуем</a>
        <a href="#directions">02 / Направления</a>
        <a href="#team">03 / Команда</a>
      </nav>

      <section
        id="purpose"
        className="about-section"
        aria-labelledby="purpose-title"
      >
        <div className="about-section-heading">
          <p className="eyebrow">01 / ЦЕЛЬ И КОНТЕКСТ</p>
          <h2 id="purpose-title">
            От невербальных сигналов
            <br />к естественному диалогу.
          </h2>
        </div>
        <div className="about-copy-grid">
          <div>
            <h3>Что хотим понять</h3>
            <p>
              Изучаем и сопоставляем методы распознавания эмоциональных
              проявлений и динамических жестов человека. Рассматриваем, как
              объединять мимические и жестовые признаки и отслеживать изменения
              состояния во времени.
            </p>
            <p>
              Наша цель — подготовить теоретическую основу для более
              естественного взаимодействия человека с роботами и
              IoT-устройствами, которые смогут учитывать невербальные сигналы
              собеседника.
            </p>
          </div>
          <div>
            <h3>Зачем нужен этот блог</h3>
            <p>
              Здесь собраны теоретические обзоры, анализ научной литературы,
              сопоставление методов и обсуждение их ограничений по пяти
              направлениям НИР. Эти же публикации используются для
              исследовательской отчётности команды.
            </p>
            <p>
              Материалы организованы по направлениям и подтемам. Искать и читать
              опубликованные статьи можно без входа в аккаунт.
            </p>
            <a className="about-text-link" href="/#materials">
              Открыть каталог <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
        <div className="about-scope">
          <div>
            <p className="eyebrow">СЕЙЧАС / НИР</p>
            <p>
              Теоретический анализ технологий, подготовка научных материалов и
              разработка этого сайта.
            </p>
          </div>
          <div>
            <p className="eyebrow">ДАЛЕЕ / ПРАКТИКА</p>
            <p>
              Программные эксперименты по распознаванию эмоций и жестов,
              разработка ROS 2-узла и практическая адаптация поведения робота.
            </p>
          </div>
        </div>
      </section>

      <section
        id="directions"
        className="about-section"
        aria-labelledby="directions-title"
      >
        <div className="about-section-heading">
          <p className="eyebrow">02 / ИССЛЕДОВАТЕЛЬСКИЕ НАПРАВЛЕНИЯ</p>
          <h2 id="directions-title">Пять ракурсов одной задачи.</h2>
        </div>
        <ol className="about-directions">
          {directions.map((direction) => (
            <li key={direction.id} className="about-direction">
              <span className="about-number" aria-hidden="true">
                0{direction.id}
              </span>
              <div>
                <h3>{direction.title}</h3>
                <p className="about-methods">{direction.methods}</p>
              </div>
              <div>
                <p>{direction.description}</p>
                <a
                  className="about-text-link"
                  href={`/?direction_id=${direction.id}#materials`}
                >
                  Материалы направления <span aria-hidden="true">↗</span>
                  <span className="sr-only">: {direction.title}</span>
                </a>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="team" className="about-section" aria-labelledby="team-title">
        <div className="about-section-heading">
          <p className="eyebrow">03 / КОМАНДА ПРОЕКТА</p>
          <h2 id="team-title">Пять участников. Общий взгляд.</h2>
        </div>
        <ul className="about-team">
          {team.map((person) => (
            <li key={person.initials}>
              <p className="about-role">{person.role}</p>
              <h3>{person.name}</h3>
              <p className="about-initials">{person.initials}</p>
              <dl>
                <dt>В проекте</dt>
                <dd>{person.responsibility}</dd>
                <dt>В исследовании</dt>
                <dd>{person.research}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
