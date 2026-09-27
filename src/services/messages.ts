// 运行时提示翻译：以中文原文查找消息表，并按占位符填入参数；新增错误码需同步三语言消息。
import catalog from "./ui-messages.json";
let language: "zh" | "en" | "ja" = "zh";
export function setMessageLanguage(value: "zh" | "en" | "ja") {
  language = value;
}
export function m(source: string, ...values: unknown[]): string {
  const translated =
    language === "zh"
      ? source
      : (catalog as Record<string, string[]>)[source]?.[
          language === "ja" ? 1 : 0
        ] || source;
  return translated.replace(/\{(\d+)\}/g, (whole, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : whole,
  );
}

