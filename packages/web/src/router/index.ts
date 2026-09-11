/**
 * Routes and the auth gate.
 *
 * The gate resolves the session once (`auth.checked`) before deciding, so a refresh
 * on a deep link does not bounce the user to /login and back.
 */
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/',
    component: () => import('../views/AppShell.vue'),
    children: [
      {
        path: '',
        name: 'transactions',
        component: () => import('../views/TransactionsView.vue'),
        meta: { title: '账单', nav: 'transactions' },
      },
      {
        path: 'transactions/new',
        name: 'transaction-new',
        component: () => import('../views/TransactionEditView.vue'),
        meta: { title: '记一笔', nav: 'transactions' },
      },
      {
        path: 'transactions/:id/edit',
        name: 'transaction-edit',
        component: () => import('../views/TransactionEditView.vue'),
        meta: { title: '编辑账单', nav: 'transactions' },
      },
      {
        path: 'budget',
        name: 'budget',
        component: () => import('../views/BudgetView.vue'),
        meta: { title: '预算', nav: 'budget' },
      },
      {
        path: 'salary/new',
        name: 'salary-new',
        component: () => import('../views/SalaryEntryView.vue'),
        meta: { title: '记工资', nav: 'budget' },
      },
      {
        path: 'salary/records',
        name: 'salary-records',
        component: () => import('../views/SalaryRecordsView.vue'),
        meta: { title: '工资记录', nav: 'budget' },
      },
      {
        path: 'templates',
        name: 'templates',
        component: () => import('../views/TemplatesView.vue'),
        meta: { title: '分配模板', nav: 'budget' },
      },
      {
        path: 'stats',
        name: 'stats',
        component: () => import('../views/StatsView.vue'),
        meta: { title: '统计', nav: 'stats' },
      },
      {
        path: 'manage',
        name: 'manage',
        component: () => import('../views/ManageView.vue'),
        meta: { title: '分类与账户', nav: 'settings' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('../views/SettingsView.vue'),
        meta: { title: '我的', nav: 'settings' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  if (!auth.checked) {
    await auth.refresh();
  }

  if (to.meta['public'] === true) {
    // Already signed in? Skip the login page.
    if (auth.username !== null && to.name === 'login') return { name: 'transactions' };
    return true;
  }

  if (auth.username === null) {
    return { name: 'login', query: { next: to.fullPath } };
  }

  return true;
});
