import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'select',
      component: () => import('../views/SelectPage.vue'),
    },
    {
      path: '/report',
      name: 'report',
      component: () => import('../views/ReportPage.vue'),
    },
  ],
})
