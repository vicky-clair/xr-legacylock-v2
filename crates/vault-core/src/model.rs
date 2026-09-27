// 解密后数据校验：限制资产字段、分类、时间、附件和总容量，拒绝未知顶层资产字段。
// 字符串长度及空白判断沿用 JavaScript 语义，避免新旧应用对同一备份给出不同结果。
use crate::{Error, Result, b64, canonical_js, exact, integer, require, string};
use serde_json::Value;
use std::collections::HashSet;
const CATEGORIES: &[&str] = &[
    "login",
    "note",
    "card",
    "identity",
    "password",
    "document",
    "sshKey",
    "apiCredential",
    "membership",
    "cryptoWallet",
    "medical",
    "reward",
    "outdoorLicense",
    "passport",
    "database",
    "router",
    "server",
    "email",
    "ssn",
    "softwareLicense",
    "bankAccount",
    "driverLicense",
    "game",
    "license",
];
// 逐项验证必需字段和附件实际字节数，最后限制完整资产数组的规范化 JSON 大小。
pub fn validate_items(items: &Value) -> Result<()> {
    let items = items.as_array().ok_or(Error("INVALID_ITEMS"))?;
    require(items.len() <= 10000, "INVALID_ITEMS")?;
    let mut ids = HashSet::new();
    for i in items {
        require(
            i.is_object()
                && string(&i["id"], 128)
                && i["id"] != ""
                && ids.insert(i["id"].as_str())
                && string(&i["title"], 1024)
                && i["title"]
                    .as_str()
                    .is_some_and(|s| !s.trim_matches(js_whitespace).is_empty())
                && i["category"]
                    .as_str()
                    .is_some_and(|s| CATEGORIES.contains(&s)),
            "INVALID_ITEMS",
        )?;
        let m = i.as_object().unwrap();
        let allowed = [
            "id",
            "title",
            "category",
            "username",
            "password",
            "url",
            "notes",
            "customFields",
            "attachments",
            "inheritanceInstructions",
            "revision",
            "createdAt",
            "updatedAt",
        ];
        require(
            m.keys().all(|k| allowed.contains(&k.as_str())),
            "INVALID_ITEMS",
        )?;
        for k in [
            "username",
            "password",
            "url",
            "notes",
            "inheritanceInstructions",
        ] {
            require(!m.contains_key(k) || string(&i[k], 100000), "INVALID_ITEMS")?;
        }
        for k in ["createdAt", "updatedAt"] {
            require(integer(&i[k], 0), "INVALID_ITEMS")?;
        }
        require(
            !m.contains_key("revision") || integer(&i["revision"], 0),
            "INVALID_ITEMS",
        )?;
        if let Some(fields) = m.get("customFields") {
            let fields = fields.as_array().ok_or(Error("INVALID_ITEMS"))?;
            require(fields.len() <= 100, "INVALID_ITEMS")?;
            for f in fields {
                require(
                    f.is_object()
                        && string(&f["id"], 128)
                        && string(&f["name"], 1024)
                        && string(&f["value"], 100000)
                        && f["isSecret"].is_boolean()
                        && (f.get("type").is_none() || string(&f["type"], 40)),
                    "INVALID_ITEMS",
                )?;
            }
        }
        if let Some(attachments) = m.get("attachments") {
            let attachments = attachments.as_array().ok_or(Error("INVALID_ITEMS"))?;
            require(attachments.len() <= 100, "INVALID_ITEMS")?;
            for a in attachments {
                require(
                    a.is_object()
                        && string(&a["id"], 128)
                        && string(&a["name"], 255)
                        && string(&a["type"], 255)
                        && integer(&a["size"], 0)
                        && a["size"].as_f64().unwrap() <= 2.0 * 1024.0 * 1024.0
                        && string(&a["data"], 3 * 1024 * 1024),
                    "INVALID_ITEMS",
                )?;
                let text = a["data"].as_str().unwrap();
                let (head, data) = text.split_once(',').ok_or(Error("INVALID_ITEMS"))?;
                require(
                    head.starts_with("data:") && head.ends_with(";base64"),
                    "INVALID_ITEMS",
                )?;
                let bytes = b64(&Value::String(data.to_owned()), None)?;
                require(
                    bytes.len() as f64 == a["size"].as_f64().unwrap(),
                    "INVALID_ITEMS",
                )?;
            }
        }
    }
    require(
        canonical_js(&Value::Array(items.clone())).len() <= 20 * 1024 * 1024,
        "INVALID_SIZE",
    )
}
// 使用 JavaScript trim 对应的空白集合，不直接采用 Rust 默认空白定义。
fn js_whitespace(c: char) -> bool {
    matches!(c,'\u{0009}'..='\u{000d}'|'\u{0020}'|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}')
}
// 检查 payload 只含 items 和 settings，并限制自动锁定时间及继承备注长度。
pub fn validate_data(d: &Value) -> Result<()> {
    require(exact(d, &["items", "settings"]), "INVALID_FORMAT")?;
    validate_items(&d["items"])?;
    let s = &d["settings"];
    require(
        exact(s, &["autoLockMinutes", "heirName", "heirNotes"])
            && s["autoLockMinutes"]
                .as_f64()
                .is_some_and(|n| [1.0, 5.0, 15.0, 30.0, 60.0].contains(&n))
            && string(&s["heirName"], 200)
            && string(&s["heirNotes"], 10000),
        "INVALID_SETTINGS",
    )
}
