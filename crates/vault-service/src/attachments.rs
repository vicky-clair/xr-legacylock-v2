// 附件边界：仅从宿主选择的文件读取，检查单文件及编码后总量，保持旧版 data URL 表示。
// 导入结果是待保存草稿；导出从当前会话按资产和附件 ID 查找，并拒绝覆盖目标文件。
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use zeroize::Zeroizing;
impl Service {
    // 读取已选附件为兼容 data URL；服务校验数量、长度和内容，结果尚未保存进资产。
    pub fn import_attachments(&self, paths: &[PathBuf], epoch: u64) -> Result<Value> {
        use std::io::Read;
        let _q = self.serial(epoch)?;
        self.assert_owner(epoch)?;
        self.writable()?;
        if paths.len() > 100 {
            return Err(Error("INVALID_ITEMS"));
        }
        let mut attachments = Vec::new();
        let mut total = 0;
        for path in paths {
            self.guard(epoch)?;
            storage::safe_path(path)?;
            let file = File::open(path).map_err(|_| Error("READ_FAILED"))?;
            let meta = file.metadata().map_err(|_| Error("READ_FAILED"))?;
            if !meta.is_file() || meta.len() > 2 * 1024 * 1024 {
                return Err(Error("INVALID_ITEMS"));
            }
            let mut bytes = Zeroizing::new(Vec::new());
            file.take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| Error("READ_FAILED"))?;
            if bytes.len() as u64 != meta.len() {
                return Err(Error("FILE_CHANGED"));
            }
            total += bytes.len().div_ceil(3) * 4;
            if total > 20 * 1024 * 1024 {
                return Err(Error("INVALID_SIZE"));
            }
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or(Error("INVALID_ITEMS"))?;
            attachments.push(json!({"id":random_token(),"name":name,"size":bytes.len(),"type":"application/octet-stream","data":format!("data:application/octet-stream;base64,{}",STANDARD.encode(&*bytes)),"uploadedAt":SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|Error("INVALID_TIME"))?.as_millis() as u64}));
        }
        vault_core::validate_items(
            &json!([{"id":"draft","title":"draft","category":"document","createdAt":0,"updatedAt":0,"attachments":attachments}]),
        )?;
        self.guard(epoch)?;
        Ok(json!({"attachments":attachments}))
    }
    // 从活动会话按双 ID 查找附件，返回去路径文件名和可清零的解码内容。
    pub fn attachment(
        &self,
        item_id: &str,
        attachment_id: &str,
        epoch: u64,
    ) -> Result<(String, Zeroizing<Vec<u8>>)> {
        self.guard(epoch)?;
        let state = mutex(&self.session)?;
        let a = state
            .as_ref()
            .filter(|a| a.epoch == epoch)
            .ok_or(Error("LOCKED"))?;
        let item = a.session.data()["items"]
            .as_array()
            .and_then(|items| items.iter().find(|i| i["id"] == item_id))
            .ok_or(Error("NOT_FOUND"))?;
        let attachment = item["attachments"]
            .as_array()
            .and_then(|items| items.iter().find(|i| i["id"] == attachment_id))
            .ok_or(Error("NOT_FOUND"))?;
        let data = attachment["data"].as_str().ok_or(Error("INVALID_ITEMS"))?;
        let (_, encoded) = data.split_once(',').ok_or(Error("INVALID_ITEMS"))?;
        let bytes = Zeroizing::new(
            STANDARD
                .decode(encoded)
                .map_err(|_| Error("INVALID_ITEMS"))?,
        );
        self.guard(epoch)?;
        let name = attachment["name"]
            .as_str()
            .unwrap_or("attachment.bin")
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("attachment.bin");
        Ok((name.to_owned(), bytes))
    }
    // 将已保存附件以明文导出，沿用不覆盖已有文件的发布规则。
    pub fn export_attachment(
        &self,
        path: &Path,
        item_id: &str,
        attachment_id: &str,
        epoch: u64,
    ) -> Result<Value> {
        let _q = self.serial(epoch)?;
        let (_, bytes) = self.attachment(item_id, attachment_id, epoch)?;
        storage::export_new(path, &bytes, &|| self.guard(epoch))?;
        Ok(json!({"path":path}))
    }
}
