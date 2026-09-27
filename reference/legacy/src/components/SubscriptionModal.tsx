import { m } from "../services/messages";
import { useEffect, useRef, useState } from "react";
import { Crown, X, CheckCircle2, Sparkles } from "lucide-react";
import type { Preferences } from "../services/vaultClient";

type Mode = Preferences["subscriptionDemo"];
const plans = [
  {
    id: "monthly",
    name: "月度服务",
    price: 28,
    period: "月",
    desc: "1 个月 · 按月体验",
  },
  {
    id: "quarterly",
    name: "季度服务",
    price: 68,
    period: "季",
    desc: "3 个月 · 按季管理",
  },
  {
    id: "yearly",
    name: "年度服务",
    price: 168,
    period: "年",
    desc: "12 个月 · 年度方案",
  },
] as const;
export function SubscriptionModal({
  mode,
  busy,
  onChange,
  onClose,
}: {
  mode: Mode;
  busy: boolean;
  onChange: (mode: Mode) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tier, setTier] = useState<"monthly" | "quarterly" | "yearly">(
    "yearly",
  );
  const [message, setMessage] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function change(next: Mode) {
    setMessage("");
    if (await onChange(next))
      setMessage(m("测试状态已保存，没有支付、扣费或生成正式授权。"));
    else setMessage(m("状态未保存，请关闭此窗口查看错误后重试。"));
  }
  return (
    <dialog
      ref={dialog}
      className="restored-dialog sub-modal-container"
      aria-labelledby="subscription-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="sub-modal-header">
        <button
          className="sub-modal-close-btn"
          onClick={onClose}
          disabled={busy}
          aria-label={m("关闭订阅测试")}
        >
          <X size={18} />
        </button>
        <div className="sub-header-content">
          <div className="sub-crown-badge">
            <Crown size={26} />
          </div>
          <div>
            <h2 id="subscription-title" className="sub-header-title">
              {m("LegacyLock 尊享订阅")}
            </h2>
            <p className="sub-header-subtitle">
              {m("月度、季度与年度服务 · 测试体验")}
            </p>
          </div>
        </div>
        <div className="sub-status-banner">
          <div className="sub-status-box">
            <CheckCircle2 size={18} />
            <span>
              {m("模拟状态：")}
              {mode === "trial"
                ? m("90 天试用（演示）")
                : mode === "expired"
                  ? m("试用到期 · 资产只读")
                  : m(
                      "{0}已开通（演示）",
                      m(plans.find((p) => p.id === mode)?.name || ""),
                    )}
            </span>
          </div>
        </div>
      </div>
      <div className="sub-modal-body">
        <p className="sub-feedback-box">
          {m(
            "测试演示，不会扣费。以下为原设计的示例价格，尚未接入支付平台和正式授权验证。订阅状态不能授予继承人管理权限。",
          )}
        </p>
        {message && (
          <p role="status" className="sub-feedback-box">
            {message}
          </p>
        )}
        <div className="sub-tiers-grid" role="group" aria-label={m("订阅套餐")}>
          {plans.map((plan) => (
            <button
              type="button"
              key={plan.id}
              aria-pressed={tier === plan.id}
              disabled={busy}
              className={`sub-tier-card ${tier === plan.id ? "selected" : ""} ${plan.id === "yearly" ? "featured" : ""}`}
              onClick={() => setTier(plan.id)}
            >
              <div className="sub-tier-header">
                <span className="sub-tier-name">{m(plan.name)}</span>
              </div>
              <div className="sub-tier-price-row">
                <span className="sub-tier-currency">¥</span>
                <span className="sub-tier-amount">{plan.price}</span>
                <span className="sub-tier-unit">/{m(plan.period)}</span>
              </div>
              <p className="sub-tier-desc">{m(plan.desc)}</p>
            </button>
          ))}
        </div>
        <div className="sub-benefits-card">
          <h3 className="sub-benefits-title">
            <Sparkles size={18} /> {m("功能体验")}
          </h3>
          <div className="sub-benefits-list">
            {[
              m("24 类资产与自定义字段"),
              m("本机加密存储与单个 2 MB 附件"),
              m("双 U 盘继承只读恢复"),
              m("背景主题、锁屏与备份设置"),
            ].map((t) => (
              <div className="sub-benefit-item" key={t}>
                <CheckCircle2 size={16} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
        <button
          className="sub-primary-subscribe-btn"
          disabled={busy}
          onClick={() => void change(tier)}
        >
          <Crown size={20} /> {m("模拟开通所选套餐（不扣费）")}
        </button>
        <div className="subscription-test-actions">
          <button disabled={busy} onClick={() => void change("expired")}>
            {m("模拟试用到期")}
          </button>
          <button disabled={busy} onClick={() => void change("trial")}>
            {m("恢复试用体验")}
          </button>
        </div>
        <p className="sub-tier-desc">
          {m(
            "模拟到期时暂停新增、修改与删除资产；所有者仍可查看、导出、管理设置和恢复试用。此状态仅属于当前安装，不随双盘备份迁移。",
          )}
        </p>
      </div>
      <div className="sub-modal-footer">
        <span>{m("本次体验无需银行卡或激活码。")}</span>
        <button
          className="sub-footer-close-btn"
          disabled={busy}
          onClick={onClose}
        >
          {m("关闭")}
        </button>
      </div>
    </dialog>
  );
}
