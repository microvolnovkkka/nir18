import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

function App() {
  const [status, setStatus] = useState('Проверяем соединение…')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setStatus('Проверяем соединение…')
    fetch('/api/health/ready', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('not ready')
        const result: unknown = await response.json()
        if (!result || typeof result !== 'object' || !('status' in result) || result.status !== 'ready') {
          throw new Error('unexpected response')
        }
        setStatus('Сервер и база данных доступны. Миграции применены.')
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('Сервер пока не готов. Проверьте запуск и повторите проверку.')
      })
    return () => controller.abort()
  }, [attempt])
  return <main>
    <p className="eyebrow">НИР / Этап 2.3.2 · часть 1</p>
    <h1>Научный блог</h1>
    <p>Каркас веб-приложения для материалов исследования эмоций и жестов.</p>
    <section aria-labelledby="health-title">
      <h2 id="health-title">Проверка окружения</h2>
      <p role="status">{status}</p>
      <button onClick={() => setAttempt(attempt + 1)}>Проверить снова</button>
    </section>
    <p className="note">Сейчас готовится основа проекта. Вход, публикации и редактор будут добавлены на следующих этапах. Реальная модель не подключена.</p>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
