import { m } from "../services/messages";
import { useState, type ReactNode } from "react";
export function BackupImport({
  busy,
  ownerSession,
  ready,
  usbControls,
  onOwner,
  onHeir,
}: {
  busy: boolean;
  ownerSession: boolean;
  ready: boolean;
  usbControls: ReactNode;
  onOwner: (password: string, secret: string) => Promise<boolean>;
  onHeir: () => Promise<boolean>;
}) {
  const [method, setMethod] = useState<"owner" | "heir">(
    ownerSession ? "owner" : "heir",
  );
  const [password, setPassword] = useState(""),
    [secret, setSecret] = useState("");
  return (
    <section className="secure-card information-import">
      <h2>{m("导入信息数据")}</h2>
      <p>
        {m(
          "选择含登录信息、安全备注和附件的 .llvault 信息备份。不要选择 .llkey 解锁密钥文件。",
        )}
      </p>
      <div className="secure-row" role="group" aria-label={m("导入解锁方式")}>
        <button
          disabled={busy}
          aria-pressed={method === "owner"}
          onClick={() => {
            setMethod("owner");
            setPassword("");
            setSecret("");
          }}
        >
          {m("密码＋安全密钥")}
        </button>
        <button
          disabled={busy}
          aria-pressed={method === "heir"}
          onClick={() => {
            setMethod("heir");
            setPassword("");
            setSecret("");
          }}
        >
          {m("双 U 盘 · 只读")}
        </button>
      </div>
      {method === "owner" ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onOwner(password, secret)) {
              setPassword("");
              setSecret("");
            }
          }}
        >
          <p>
            {ownerSession
              ? m(
                  "验证备份的密码和安全密钥后合并信息数据；保留本机设置和双盘配置，冲突记录作为副本导入。",
                )
              : m(
                  "同时验证备份的密码和安全密钥后导入，可完整管理。若本机已有不同密库，请先解锁本机，再从导入导出页合并。",
                )}
          </p>
          <label>
            {m("备份密码")}
            <input
              required
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            {m("备份安全密钥")}
            <input
              required
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
          <button disabled={busy} className="primary">
            {m("选择信息备份并验证导入")}
          </button>
        </form>
      ) : (
        <>
          {usbControls}
          <p>
            {m(
              "两盘只授予查看权限，不覆盖本机密库。修改数据或设置仍需该备份的密码和安全密钥；拔出任一盘会锁定。",
            )}
          </p>
          <button
            disabled={busy || !ready}
            className="primary"
            onClick={() => void onHeir()}
          >
            {m("选择信息备份并只读访问")}
          </button>
          <p className="secure-hint">
            {m(
              "主盘保存信息备份和主解锁密钥；副盘只保存副解锁密钥。未配置双盘前导出的文件不具备双盘恢复能力。",
            )}
          </p>
        </>
      )}
    </section>
  );
}
