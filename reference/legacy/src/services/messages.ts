import catalog from "../../electron/ui-messages.json";
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
