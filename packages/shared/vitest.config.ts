import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 预算引擎是纯函数，无需 DOM；用 node 环境跑得最快。
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 覆盖率只在需要时手动开启，默认不拖慢 CI。
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
