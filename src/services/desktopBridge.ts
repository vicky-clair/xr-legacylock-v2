// 桌面 IPC 边界：将公开方法映射到固定命令和具名参数，过滤过期回复与进度事件。
// 这里不授予文件系统权限；原生主窗口身份和所有者权限仍由 Rust 检查。
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// 显式具名 DTO：不能把任意位置参数数组直接转发给 Rust。
export const commandSpecs = {
  status: ['status', []], newSecret: ['new_secret', []],
  initialize: ['initialize', ['password', 'secret']],
  unlock: ['unlock', ['password', 'secret']], unlockLocal: ['unlock_local', ['password']],
  localUnlockStatus: ['local_unlock_status', []],
  setRememberedSecret: ['set_remembered_secret', ['enabled', 'password', 'secret']],
  lock: ['lock', []], saveItem: ['save_item', ['item']], deleteItem: ['delete_item', ['id']],
  settings: ['settings', ['settings']], scan: ['scan', ['progress']],
  provision: ['provision', ['primary', 'secondary', 'password', 'secret', 'progress']], sync: ['sync', ['primary', 'progress']],
  recover: ['recover', ['primary', 'secondary', 'progress']], importOwner: ['import_owner', ['password', 'secret', 'progress']],
  export: ['export', ['password', 'secret', 'progress']], credentials: ['credentials', ['password', 'secret', 'newPassword', 'newSecret']],
  health: ['health', []], importData: ['import_data', ['password', 'secret', 'progress']],
  prepareDestroy: ['prepare_destroy', ['password', 'secret']], destroy: ['destroy', ['token', 'confirmation']],
  preferences: ['preferences', []], setPreferences: ['set_preferences', ['preferences']],
  windowControl: ['window_control', ['action']], viewLanguage: ['view_language', ['language']],
  copy: ['copy', ['text']],
  exportAttachment: ['export_attachment', ['itemId', 'attachmentId', 'progress']],
  importAttachments: ['import_attachments', ['progress']],
  getItem: ['get_item', ['id']], searchItems: ['search_items', ['query']],
} as const;
export type Method = keyof typeof commandSpecs;
type Reply = { ok: true; value: unknown } | { ok: false; error: string };
let epoch = 0;
const callbacks = new Set<() => void>();
export type ProgressStage = 'choosing' | 'scanning' | 'processing';
const progressCallbacks = new Set<(stage: ProgressStage | null) => void>();
let progressSequence = 0, activeProgress = 0;
function progressChanged(stage: ProgressStage | null) { progressCallbacks.forEach(fn => fn(stage)); }
let listening: Promise<void> | undefined;
// 锁定同时使回复与进度失效，防止慢任务重新显示秘密。
function invalidate() { epoch++; activeProgress = 0; progressChanged(null); callbacks.forEach(fn => fn()); }
// 先建立锁定监听再发请求；监听失败时不继续业务调用。
function ensureListener() {
  listening ??= listen('secure:locked', invalidate).then(() => undefined).catch(error => { listening = undefined; throw error; });
  return listening;
}
export const desktopBridge = {
  available: () => isTauri(),
  async call(method: Method, args: unknown[]): Promise<Reply> {
    if (!isTauri()) return { ok: false, error: 'DESKTOP_REQUIRED' };
    let finishProgress = () => {};
    try {
      await ensureListener();
      if (method === 'lock') invalidate();
      const started = epoch;
      const [command, names] = commandSpecs[method];
      const dto = Object.fromEntries(names.map((name, index) => [name, args[index] ?? null]));
      // 每次请求创建独立 Channel，覆盖外部传入值；只接收白名单阶段。
      if ('progress' in dto) {
        const id = ++progressSequence;
        let finished = false;
        const channel = new Channel<{stage: ProgressStage}>();
        channel.onmessage = message => {
          if (finished || started !== epoch || !['choosing', 'scanning', 'processing'].includes(message?.stage)) return;
          activeProgress = id; progressChanged(message.stage);
        };
        dto.progress = channel;
        finishProgress = () => { finished = true; if (activeProgress === id) {activeProgress = 0; progressChanged(null);} };
      }
      let value: unknown;
      // 只重试幂等读取；写操作不能因忙碌自动重放。
      for (let attempt = 0; ; attempt++) {
        if (started !== epoch && method !== 'lock') return { ok: false, error: 'LOCKED' };
        try { value = await invoke(command, dto); break; }
        catch (error) {
          if (error !== 'TRY_LATER' || !['getItem', 'searchItems', 'status'].includes(method) || attempt >= 20) throw error;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      if (started !== epoch && method !== 'lock') return { ok: false, error: 'LOCKED' };
      return { ok: true, value };
    } catch (e) {
      // 只放行稳定错误码，避免把宿主任意异常内容展示给用户。
      const code = typeof e === 'string' && /^[A-Z_]+$/.test(e) ? e : 'OPERATION_FAILED';
      return { ok: false, error: code };
    } finally {
      finishProgress();
    }
  },
  onLocked(callback: () => void) { callbacks.add(callback); void ensureListener().catch(invalidate); return () => { callbacks.delete(callback); }; },
  onProgress(callback: (stage: ProgressStage | null) => void) { progressCallbacks.add(callback); return () => {progressCallbacks.delete(callback);}; },
  activity() { if (isTauri()) void invoke('activity').catch(() => {}); },
};
