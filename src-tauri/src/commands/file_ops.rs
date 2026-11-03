use std::fs;
use tauri_plugin_dialog::DialogExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileResult {
    pub path: String,
    pub content: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    name: String,
    path: String,
    relative_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryScan {
    files: Vec<DirectoryEntry>,
    skipped_directories: usize,
}

#[tauri::command]
pub async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.dialog().file().blocking_pick_folder().map(|path| {
        path.into_path()
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(|e| format!("无法打开文件夹：{e}"))
    }).transpose()
}

#[tauri::command]
pub async fn scan_directory(path: String, extensions: Vec<String>) -> Result<DirectoryScan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = std::path::PathBuf::from(&path);
        let mut pending = vec![root.clone()];
        let mut files = Vec::new();
        let mut skipped_directories = 0;
        while let Some(directory) = pending.pop() {
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(e) if directory == root => return Err(format!("无法读取文件夹：{e}")),
                Err(_) => { skipped_directories += 1; continue; }
            };
            for entry in entries {
                let entry = match entry { Ok(entry) => entry, Err(_) => { skipped_directories += 1; continue; } };
                let file_type = match entry.file_type() { Ok(kind) => kind, Err(_) => { skipped_directories += 1; continue; } };
                // Do not follow links, so directory cycles and external targets are not scanned.
                if file_type.is_symlink() { continue; }
                let child = entry.path();
                if file_type.is_dir() {
                    pending.push(child);
                } else if file_type.is_file() && child.extension().and_then(|ext| ext.to_str())
                    .is_some_and(|ext| extensions.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed))) {
                    let relative_path = child.strip_prefix(&root).map_err(|e| e.to_string())?;
                    files.push(DirectoryEntry {
                        name: entry.file_name().to_string_lossy().into_owned(),
                        path: child.to_string_lossy().into_owned(),
                        relative_path: relative_path.to_string_lossy().replace('\\', "/"),
                    });
                }
            }
        }
        files.sort_by(|a, b| a.relative_path.to_lowercase().cmp(&b.relative_path.to_lowercase()));
        Ok(DirectoryScan { files, skipped_directories })
    }).await.map_err(|e| format!("扫描失败：{e}"))?
}

#[tauri::command]
pub async fn open_file(app: tauri::AppHandle) -> Result<Option<FileResult>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("DBML files", &["dbml"])
        .add_filter("All files", &["*"])
        .blocking_pick_file();

    match file {
        Some(file_path) => {
            let path_buf = file_path
                .into_path()
                .map_err(|e| format!("Invalid path: {}", e))?;
            let content = fs::read_to_string(&path_buf)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            Ok(Some(FileResult {
                path: path_buf.to_string_lossy().to_string(),
                content,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

fn check_unchanged(path: &str, expected_content: Option<String>) -> Result<(), String> {
    let expected = expected_content.ok_or("FILE_CHANGED: 无法确认磁盘文件的原始内容，请先处理外部修改")?;
    let current = fs::read_to_string(path)
        .map_err(|e| format!("FILE_CHANGED: 无法读取磁盘文件：{e}"))?;
    if current != expected {
        return Err("FILE_CHANGED: 文件已在外部修改，请先处理冲突".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn open_sql_file(app: tauri::AppHandle) -> Result<Option<FileResult>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("SQL files", &["sql"])
        .add_filter("All files", &["*"])
        .blocking_pick_file();

    match file {
        Some(file_path) => {
            let path_buf = file_path
                .into_path()
                .map_err(|e| format!("Invalid path: {}", e))?;
            let content = fs::read_to_string(&path_buf)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            Ok(Some(FileResult {
                path: path_buf.to_string_lossy().to_string(),
                content,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn save_file(
    app: tauri::AppHandle,
    content: String,
    path: Option<String>,
    expected_content: Option<String>,
) -> Result<Option<String>, String> {
    let save_path = if let Some(p) = path {
        check_unchanged(&p, expected_content)?;
        std::path::PathBuf::from(p)
    } else {
        let file = app
            .dialog()
            .file()
            .add_filter("DBML files", &["dbml"])
            .set_file_name("schema.dbml")
            .blocking_save_file();

        match file {
            Some(fp) => fp.into_path().map_err(|e| format!("Invalid path: {}", e))?,
            None => return Ok(None),
        }
    };

    fs::write(&save_path, content)
        .map_err(|e| format!("Failed to save file: {}", e))?;

    Ok(Some(save_path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_only_supported_files_in_nested_directories() {
        let root = std::env::temp_dir().join(format!("diagrams-scan-{}", std::process::id()));
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested").join("model.DBML"), "").unwrap();
        fs::write(root.join("nested").join("notes.txt"), "").unwrap();
        let scan = tauri::async_runtime::block_on(scan_directory(
            root.to_string_lossy().into_owned(), vec!["dbml".into()],
        )).unwrap();
        assert_eq!(scan.files.len(), 1);
        assert_eq!(scan.files[0].relative_path, "nested/model.DBML");
        assert_eq!(scan.skipped_directories, 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_saving_over_changed_or_missing_files() {
        let path = std::env::temp_dir().join(format!("diagrams-conflict-{}.dbml", std::process::id()));
        fs::write(&path, "external").unwrap();
        let name = path.to_str().unwrap();
        assert!(check_unchanged(name, Some("external".into())).is_ok());
        assert!(check_unchanged(name, Some("original".into())).is_err());
        assert!(check_unchanged(name, None).is_err());
        fs::remove_file(&path).unwrap();
        assert!(check_unchanged(name, Some("external".into())).is_err());
    }
}

#[tauri::command]
pub async fn export_sql_file(
    app: tauri::AppHandle,
    sql: String,
    dialect: String,
) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("SQL files", &["sql"])
        .set_file_name(&format!("schema_{}.sql", dialect))
        .blocking_save_file();

    match file {
        Some(fp) => {
            let path_buf = fp.into_path().map_err(|e| format!("Invalid path: {}", e))?;
            fs::write(&path_buf, sql)
                .map_err(|e| format!("Failed to save SQL: {}", e))?;
            Ok(Some(path_buf.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}
