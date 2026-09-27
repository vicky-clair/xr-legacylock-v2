/**
 * ============================================================================
 * LegacyLock 军规遗产密钥库 — 前端渲染主入口 (Frontend Entrypoint)
 * ============================================================================
 * 
 * 职责：
 * 1. 挂载 React 19 渲染根节点 (Root Node)；
 * 2. 引入全项目设计系统、中文字体栈与基础 CSS 样式 (index.css)；
 * 3. 启用 React.StrictMode 实施严格生命周期与副作用合规性检查。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { I18nProvider } from './services/i18n';

// 获取 HTML 模板中的 root 容器并挂载 React 顶层应用组件
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
