import { createRouter, createWebHistory } from 'vue-router'
import { useCompareStore } from '../stores/compare'
import { useEditorStore } from '../stores/editor'
import { useSearchStore } from '../stores/search'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'select',
      component: () => import('../views/SelectPage.vue'),
    },
    {
      // Rev. 5-3: session id in the URL — a hard reload of /report/:sessionId
      // re-derives the id from persisted meta and restores segments from IndexedDB.
      path: '/report/:sessionId',
      name: 'report',
      component: () => import('../views/ReportPage.vue'),
    },
    // Rev. 5-4: unknown routes fall back to the select page instead of a blank error.
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  // Rev. 5-4: scroll to top on navigation. The report page uses an inner
  // scroll container, so this only affects cross-page navigation.
  scrollBehavior() {
    return { top: 0 }
  },
})

/**
 * Rev. 5-7: leaving the report page resets in-memory compare/editor state.
 * Safe — edit drafts are already persisted (IndexedDB + localStorage + backend)
 * before the user can navigate away, so nothing is lost.
 */
router.beforeEach((to, from) => {
  const fromReport = from.path.startsWith('/report')
  const toReport = to.path.startsWith('/report')
  if (fromReport && !toReport) {
    const compare = useCompareStore()
    const editor = useEditorStore()
    const search = useSearchStore()
    if (editor.isEditing) editor.exitEdit()
    editor.resetToOriginal()
    compare.reset()
    search.close()
  }
  return true
})
