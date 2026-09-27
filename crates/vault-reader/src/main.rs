// 独立命令行恢复阅读器：不依赖 Tauri、WebView2 或 Node。
// 所有者凭据通过隐藏输入读取；输出为明文 JSON，拒绝覆盖已有文件，写入失败可能留下部分明文。
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    path::Path,
};
use vault_core::{Error, MAX_BYTES, Result};
use zeroize::Zeroizing;
// 有界读取输入，不把过大文件完整装入内存。
fn read(path: &str) -> Result<serde_json::Value> {
    let mut bytes = Zeroizing::new(Vec::new());
    std::fs::File::open(path)
        .map_err(|_| Error("INPUT_IO"))?
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| Error("INPUT_IO"))?;
    vault_core::parse(&bytes)
}
// 解析两种恢复模式并显式输出明文；密码不通过命令行参数传递。
fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let valid = matches!(args.first().map(String::as_str), Some("owner")) && args.len() == 3
        || matches!(args.first().map(String::as_str), Some("recovery")) && args.len() == 5;
    if !valid {
        eprintln!(
            "Usage: vault-reader owner INPUT OUTPUT\n       vault-reader recovery INPUT PRIMARY SECONDARY OUTPUT\nCredentials are prompted privately. OUTPUT is PLAINTEXT; existing files are never overwritten."
        );
        return Err(Error("INVALID_ARGUMENTS"));
    }
    let input = read(&args[1])?;
    let session = if args[0] == "owner" {
        let password = Zeroizing::new(
            rpassword::prompt_password("Password: ").map_err(|_| Error("CREDENTIAL_INPUT"))?,
        );
        let secret = Zeroizing::new(
            rpassword::prompt_password("LL3 secret: ").map_err(|_| Error("CREDENTIAL_INPUT"))?,
        );
        vault_core::unlock_owner(input, &password, &secret)?
    } else {
        vault_core::unlock_recovery(input, &read(&args[2])?, &read(&args[3])?)?
    };
    eprintln!("WARNING: exporting decrypted assets and attachments as PLAINTEXT JSON.");
    let bytes = Zeroizing::new(vault_core::canonical_js(session.data()).into_bytes());
    let path = Path::new(args.last().unwrap());
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| Error("OUTPUT_EXISTS_OR_UNAVAILABLE"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| Error("OUTPUT_IO_PARTIAL_PLAINTEXT_MAY_EXIST"))?;
    eprintln!("Export complete. Store the plaintext output securely.");
    Ok(())
}
// 只输出稳定错误码，失败以非零退出码结束。
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
