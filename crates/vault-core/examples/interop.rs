// 协议互操作测试入口：通过标准输入接收合成 JSON 请求，为 Node 对照测试调用 Rust 核心；不属于桌面运行时。
//! 仅用于合成样本互操作测试，不随阅读器或桌面程序打包。
use serde_json::{Value, json};
use std::io::Read;
fn run(v: Value) -> vault_core::Result<Value> {
    let text = |k: &str| v[k].as_str().unwrap_or("");
    if text("op") == "canonical" {
        return Ok(json!(vault_core::canonical_js(&v["value"])));
    }
    let mut s = if text("op") == "create" {
        vault_core::create(text("password"), text("secret"), v["items"].clone())?
    } else if text("op") == "recovery" {
        vault_core::unlock_recovery(v["envelope"].clone(), &v["primary"], &v["secondary"])?
    } else {
        vault_core::unlock_owner(v["envelope"].clone(), text("password"), text("secret"))?
    };
    if let Some(data) = v.get("data") {
        s.update(data.clone())?;
    }
    if text("op") == "rewrap" {
        s.rewrap(text("newPassword"), text("newSecret"))?;
    }
    let shares = if text("op") == "rotate" {
        Some(s.rotate_recovery(text("password"), text("secret"))?)
    } else if v["provision"] == true {
        Some(s.provision()?)
    } else {
        None
    };
    let mut out = json!({"envelope":s.envelope(),"data":s.data(),"owner":s.is_owner()});
    if let Some((a, b)) = shares {
        out["primary"] = a;
        out["secondary"] = b;
    }
    Ok(out)
}
fn main() {
    let mut bytes = Vec::new();
    std::io::stdin()
        .take((vault_core::MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .unwrap();
    let out = match vault_core::parse(&bytes).and_then(run) {
        Ok(v) => json!({"ok":true,"value":v}),
        Err(e) => json!({"ok":false,"error":e.0}),
    };
    println!("{}", out);
}
