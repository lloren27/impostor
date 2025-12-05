import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faClipboard as faClipboardRegular } from '@fortawesome/free-regular-svg-icons'

import './assets/styles/main.scss'

library.add(faClipboardRegular)

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

app.component('font-awesome-icon', FontAwesomeIcon)

app.mount('#app')
