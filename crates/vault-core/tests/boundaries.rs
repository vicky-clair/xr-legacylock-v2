// 协议边界测试：验证规范化、凭据及恢复权限等约束；测试数据为公开或临时合成数据。
use serde_json::json;
use vault_core::*;

#[test]
fn parser_rejects_oversize_invalid_utf8_and_lone_surrogates() {
    assert_eq!(
        parse(&vec![b' '; MAX_BYTES + 1]),
        Err(Error("INVALID_SIZE"))
    );
    assert_eq!(parse(b"\"\\ud800\""), Err(Error("INVALID_FORMAT")));
    assert_eq!(parse(&[b'"', 0xff, b'"']), Err(Error("INVALID_FORMAT")));
    assert_eq!(parse(b"{\"a\":1,\"a\":2}").unwrap(), json!({"a":2}));
    assert_eq!(parse(b"\"\\ud83d\\ude00\"").unwrap(), json!("😀"));
    let deep = format!("{}0{}", "[".repeat(130), "]".repeat(130));
    assert_eq!(parse(deep.as_bytes()), Err(Error("INVALID_FORMAT")));
}

#[test]
fn canonical_numbers_and_utf16_order() {
    let value = parse(br#"[-0,1.0,1e-7,0.000001,100000000000000000000,1e21]"#).unwrap();
    assert_eq!(
        canonical_js(&value),
        "[0,1,1e-7,0.000001,100000000000000000000,1e+21]"
    );
    assert_eq!(
        canonical_js(&json!({"\u{e000}":1,"\u{10000}":2})),
        "{\"𐀀\":2,\"\":1}"
    );
}

fn item() -> serde_json::Value {
    json!({"id":"i","title":"asset","category":"note","createdAt":0,"updatedAt":0})
}

#[test]
fn model_limits_optional_fields_and_extensions() {
    let mut i = item();
    i["title"] = json!("😀".repeat(512));
    assert!(validate_items(&json!([i.clone()])).is_ok());
    i["title"] = json!("😀".repeat(513));
    assert_eq!(validate_items(&json!([i])), Err(Error("INVALID_ITEMS")));
    assert_eq!(
        validate_items(&json!([item(), item()])),
        Err(Error("INVALID_ITEMS"))
    );
    let mut i = item();
    i["customFields"] = json!([{"id":"","name":"","value":"0","isSecret":false,"future":true}]);
    assert!(validate_items(&json!([i.clone()])).is_ok());
    i["notes"] = serde_json::Value::Null;
    assert_eq!(validate_items(&json!([i])), Err(Error("INVALID_ITEMS")));
    let mut i = item();
    i["customFields"] = json!(vec![json!({}); 101]);
    assert_eq!(validate_items(&json!([i])), Err(Error("INVALID_ITEMS")));
    assert_eq!(
        validate_items(&json!(vec![item(); 10001])),
        Err(Error("INVALID_ITEMS"))
    );
}

#[test]
fn signed_fixture_tampering_is_rejected() {
    let bytes = include_bytes!("../../../reference/legacy/tests/fixtures/v3-vault.json");
    let mut v = parse(bytes).unwrap();
    validate_envelope(&v).unwrap();
    v["format"] = json!(3.0);
    validate_envelope(&v).unwrap();
    v["revision"] = json!(9007199254740992u64);
    assert_eq!(validate_envelope(&v), Err(Error("UNSUPPORTED_FORMAT")));
    v["revision"] = json!(777);
    assert_eq!(validate_envelope(&v), Err(Error("INVALID_SIGNATURE")));
}
