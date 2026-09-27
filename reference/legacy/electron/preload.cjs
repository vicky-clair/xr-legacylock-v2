"use strict";
/**
 * Electron 预加载脚本 (Preload Script)
 * 
 * 安全机制：
 * 1. 上下文隔离 (Context Isolation)：前端渲染进程完全无权直接访问 Node.js 原生 API 与文件系统；
 * 2. 白名单 IPC 映射：仅严格暴露 methods 白名单中定义的安全操作方法；
 * 3. 冻结暴露对象 (Object.freeze)：防止渲染端原型链污染或篡改通信通道；
 * 4. 主动推模式锁定监听：通过 onLocked 接收主进程因休眠、锁屏或异常触发的安全锁定信号。
 */
const { contextBridge, ipcRenderer } = require("electron");

// 严格受限的 IPC 方法调用白名单列表
const methods = [
  "status",
  "newSecret",
  "initialize",
  "unlock",
  "unlockLocal",
  "localUnlockStatus",
  "setRememberedSecret",
  "lock",
  "saveItem",
  "deleteItem",
  "settings",
  "scan",
  "provision",
  "sync",
  "recover",
  "importOwner",
  "export",
  "credentials",
  "health",
  "importData",
  "prepareDestroy",
  "destroy",
  "preferences",
  "setPreferences",
  "windowControl",
  "viewLanguage",
  "copy",
];
const api = {};
for (const method of methods)
  api[method] = (...args) => ipcRenderer.invoke("secure:" + method, ...args);
api.onLocked = (callback) => {
  const listener = () => callback();
  ipcRenderer.on("secure:locked", listener);
  return () => ipcRenderer.removeListener("secure:locked", listener);
};
api.activity = () => ipcRenderer.send("secure:activity");
contextBridge.exposeInMainWorld("vaultAPI", Object.freeze(api));
