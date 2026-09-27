// 前端构建配置：固定本机开发端口，并阻止旧 Electron、参考实现或模拟密库模块进入运行时产物。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react(), {
    name: 'runtime-boundaries',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        if (/\/(reference|electron)\//.test(id.replace(/\\/g, '/')) || /\/services\/(cryptoService|mockData)\.ts$/.test(id.replace(/\\/g, '/'))) this.error(`Forbidden runtime module: ${id}`);
      }
    },
  }],
  base: './',
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { outDir: 'dist', sourcemap: false },
});
