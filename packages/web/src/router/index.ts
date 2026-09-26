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
        name: 'dashboard',
        component: () => import('../views/DashboardView.vue'),
        meta: { title: '首页', nav: 'dashboard' },
      },
      {
        path: 'transactions',
        name: 'transactions',
        component: () => import('../views/TransactionsView.vue'),
        meta: { title: '账单', nav: 'transactions' },
      },
      {
        path: 'assistant',
        name: 'assistant',
        component: () => import('../views/AssistantView.vue'),
        meta: { title: 'AI 助理', nav: 'assistant' },
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
        path: 'trash',
        name: 'trash',
        component: () => import('../views/TrashView.vue'),
        // Reached from 我的, so that tab stays highlighted. No seventh tab: the bar was
        // verified to fit exactly six at 375px.
        meta: { title: '回收站', nav: 'settings' },
      },
      {
        path: 'transfers',
        name: 'transfers',
        component: () => import('../views/TransfersView.vue'),
        // Reached from the home asset card and from 我的 › 账户. `nav: 'dashboard'` keeps the
        // 首页 tab lit, which is where the balance these rows move is displayed.
        meta: { title: '转账', nav: 'dashboard' },
      },
      {
        path: 'transfers/new',
        name: 'transfer-new',
        component: () => import('../views/TransferEditView.vue'),
        meta: { title: '记一笔转账', nav: 'dashboard' },
      },
      {
        path: 'transfers/:id/edit',
        name: 'transfer-edit',
        component: () => import('../views/TransferEditView.vue'),
        meta: { title: '编辑转账', nav: 'dashboard' },
      },
      {
        path: 'recurring',
        name: 'recurring-rules',
        component: () => import('../views/RecurringRulesView.vue'),
        meta: { title: '周期账单', nav: 'settings' },
      },
      {
        path: 'recurring/new',
        name: 'recurring-rule-new',
        component: () => import('../views/RecurringRuleEditView.vue'),
        meta: { title: '新建周期账单', nav: 'settings' },
      },
      {
        path: 'recurring/:id/edit',
        name: 'recurring-rule-edit',
        component: () => import('../views/RecurringRuleEditView.vue'),
        meta: { title: '编辑周期账单', nav: 'settings' },
      },
      {
        path: 'pending',
        name: 'recurring-pending',
        component: () => import('../views/PendingOccurrencesView.vue'),
        // Reached from the dashboard's reminder card, so the 首页 tab stays highlighted.
        meta: { title: '待确认账单', nav: 'dashboard' },
      },
      {
        path: 'data',
        name: 'data',
        component: () => import('../views/DataView.vue'),
        meta: { title: '数据导出与备份', nav: 'settings' },
      },
      {
        path: 'items',
        name: 'items',
        component: () => import('../views/ItemsView.vue'),
        meta: { title: '物品资产', nav: 'settings' },
      },
      {
        path: 'items/new',
        name: 'item-new',
        component: () => import('../views/ItemEditView.vue'),
        meta: { title: '添加物品', nav: 'settings' },
      },
      {
        path: 'items/:id/edit',
        name: 'item-edit',
        component: () => import('../views/ItemEditView.vue'),
        meta: { title: '编辑物品', nav: 'settings' },
      },
      {
        path: 'items/:id/close',
        name: 'item-close',
        component: () => import('../views/ItemCloseView.vue'),
        meta: { title: '结束持有', nav: 'settings' },
      },
      {
        path: 'items/:id',
        name: 'item-detail',
        component: () => import('../views/ItemDetailView.vue'),
        meta: { title: '物品详情', nav: 'settings' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('../views/SettingsView.vue'),
        meta: { title: '我的', nav: 'settings' },
      },
      {
        path: 'settings/ai',
        name: 'ai-settings',
        component: () => import('../views/AiProviderSettingsView.vue'),
        meta: { title: 'AI 助手', nav: 'settings' },
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
    // Already signed in? Skip the login page and land on the dashboard.
    if (auth.username !== null && to.name === 'login') return { name: 'dashboard' };
    return true;
  }

  if (auth.username === null) {
    return { name: 'login', query: { next: to.fullPath } };
  }

  return true;
});
