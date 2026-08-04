import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import App from './App.vue'
import './styles/main.css'
import { reportError } from './utils/observability'

const app = createApp(App)

// Rev. 5-9: global error handlers — a render error should never silently
// freeze the UI with no diagnostic. All errors funnel through reportError
// (rev. 5-20 observability channel).
app.config.errorHandler = (err, _instance, info) => {
  reportError(err, `vue:${info ?? ''}`)
}

window.addEventListener('error', (e) => {
  reportError(new Error(`${e.message} @ ${e.filename}:${e.lineno}`), 'window:error')
})

window.addEventListener('unhandledrejection', (e) => {
  reportError(e.reason, 'unhandledrejection')
})

app.use(createPinia())
app.use(router)
app.mount('#app')
