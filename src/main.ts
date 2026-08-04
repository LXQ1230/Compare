import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import App from './App.vue'
import './styles/main.css'

const app = createApp(App)

// Rev. 5-9: global error handlers — a render error should never silently
// freeze the UI with no diagnostic. All errors funnel through console.error
// (5-20's observability channel can hook in here later).
app.config.errorHandler = (err, _instance, info) => {
  console.error(`[app:error] ${info ?? ''}`, err)
}

window.addEventListener('error', (e) => {
  console.error('[window:error]', e.message, e.filename, `line:${e.lineno}`)
})

window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason)
})

app.use(createPinia())
app.use(router)
app.mount('#app')
