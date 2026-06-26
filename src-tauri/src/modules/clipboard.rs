use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

// `Command` is only used by the macOS clipboard helpers (pbpaste/osascript/sips).
#[cfg(target_os = "macos")]
use std::process::Command;

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

#[tauri::command]
pub fn terminal_clipboard_paths() -> Result<Vec<String>, String> {
    clipboard_paths()
}

#[tauri::command]
pub fn terminal_clipboard_image_paths() -> Result<Vec<String>, String> {
    clipboard_image_paths()
}

#[tauri::command]
pub fn terminal_clipboard_text() -> Result<String, String> {
    clipboard_text()
}

#[tauri::command]
pub fn terminal_prepare_clipboard_image_attachment(path: String) -> Result<(), String> {
    prepare_clipboard_image_attachment(Path::new(&path))
}

#[tauri::command]
pub fn terminal_save_dropped_image(
    name: Option<String>,
    mime: Option<String>,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("dropped image is empty".to_string());
    }
    let ext = image_extension(name.as_deref(), mime.as_deref(), &bytes)
        .ok_or_else(|| "dropped file is not a supported image".to_string())?;
    let path = unique_temp_image_path(ext)?;
    fs::write(&path, bytes).map_err(|e| format!("failed to save dropped image: {e}"))?;
    Ok(path_to_string(path))
}

#[cfg(target_os = "macos")]
fn clipboard_paths() -> Result<Vec<String>, String> {
    Ok(unique_paths(macos_clipboard_file_paths()?))
}

#[cfg(target_os = "windows")]
fn clipboard_paths() -> Result<Vec<String>, String> {
    use clipboard_win::{formats, get_clipboard};
    // Files copied in Explorer arrive as CF_HDROP. A missing format (e.g. text
    // was copied instead) is not an error here — report no paths so the paste
    // flow falls through, matching the macOS branch.
    let paths: Vec<String> = get_clipboard(formats::FileList).unwrap_or_default();
    Ok(unique_paths(
        paths
            .into_iter()
            .filter(|path| Path::new(path).exists())
            .collect(),
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn clipboard_paths() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "macos")]
fn clipboard_image_paths() -> Result<Vec<String>, String> {
    let image_paths: Vec<String> = clipboard_paths()?
        .into_iter()
        .filter(|path| is_image_path(Path::new(path)))
        .collect();
    if !image_paths.is_empty() {
        return Ok(image_paths);
    }

    let target = unique_temp_image_path("png")?;
    if macos_write_clipboard_png(&target)? {
        Ok(vec![path_to_string(target)])
    } else {
        Ok(Vec::new())
    }
}

#[cfg(not(target_os = "macos"))]
fn clipboard_image_paths() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// Spawn a macOS helper with a forced UTF-8 codeset. A GUI (Finder) launch
/// inherits no UTF-8 locale, so `pbpaste`/`osascript` fall back to the region's
/// legacy encoding (e.g. Big5 for zh-Hant) and their non-ASCII output then
/// fails to decode as UTF-8, leaving replacement characters. `LC_ALL` outranks
/// any inherited locale, so it reliably pins the codeset to UTF-8.
#[cfg(target_os = "macos")]
fn utf8_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd
}

#[cfg(target_os = "macos")]
fn clipboard_text() -> Result<String, String> {
    let output = utf8_command("pbpaste")
        .output()
        .map_err(|e| format!("failed to run pbpaste: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "windows")]
fn clipboard_text() -> Result<String, String> {
    use clipboard_win::{formats, get_clipboard};
    // No Unicode text on the clipboard (e.g. only files were copied) is not an
    // error: return empty so the paste flow falls through to file paths.
    Ok(get_clipboard(formats::Unicode).unwrap_or_default())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn clipboard_text() -> Result<String, String> {
    Ok(String::new())
}

#[cfg(target_os = "macos")]
fn prepare_clipboard_image_attachment(path: &Path) -> Result<(), String> {
    if !is_image_path(path) {
        return Err("clipboard path is not a supported image".to_string());
    }
    let png_path = if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
    {
        path.to_path_buf()
    } else {
        let target = unique_temp_image_path("png")?;
        let output = Command::new("sips")
            .arg("-s")
            .arg("format")
            .arg("png")
            .arg(path)
            .arg("--out")
            .arg(&target)
            .output()
            .map_err(|e| format!("failed to run sips: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        target
    };
    macos_set_clipboard_png(&png_path)
}

#[cfg(not(target_os = "macos"))]
fn prepare_clipboard_image_attachment(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_clipboard_file_paths() -> Result<Vec<String>, String> {
    let script = r#"
set oldDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to linefeed
try
  set outputPaths to {}
  try
    set end of outputPaths to POSIX path of (the clipboard as alias)
  end try
  try
    set end of outputPaths to POSIX path of (the clipboard as «class furl»)
  end try
  try
    set copiedItems to the clipboard as list
    repeat with copiedItem in copiedItems
      try
        set end of outputPaths to POSIX path of copiedItem
      end try
    end repeat
  end try
  set resultText to outputPaths as text
on error
  set resultText to ""
end try
set AppleScript's text item delimiters to oldDelimiters
return resultText
"#;
    let output = run_osascript(script)?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| is_valid_clipboard_file_path(line))
        .map(ToOwned::to_owned)
        .collect())
}

#[cfg(target_os = "macos")]
fn macos_set_clipboard_png(path: &Path) -> Result<(), String> {
    let script = format!(
        r#"
try
  set imageData to read (POSIX file "{}") as «class PNGf»
  set the clipboard to imageData
  return "ok"
on error err
  return err
end try
"#,
        applescript_string(path)
    );
    let output = run_osascript(&script)?;
    if output.trim() == "ok" {
        Ok(())
    } else {
        Err(output)
    }
}

#[cfg(target_os = "macos")]
fn macos_write_clipboard_png(path: &Path) -> Result<bool, String> {
    let script = format!(
        r#"
try
  set imageData to the clipboard as «class PNGf»
  set outputFile to POSIX file "{}"
  set fileRef to open for access outputFile with write permission
  set eof fileRef to 0
  write imageData to fileRef
  close access fileRef
  return "ok"
on error
  try
    close access outputFile
  end try
  return ""
end try
"#,
        applescript_string(path)
    );
    let output = run_osascript(&script)?;
    if output.trim() != "ok" {
        return Ok(false);
    }
    Ok(fs::metadata(path)
        .map(|meta| meta.len() > 0)
        .unwrap_or(false))
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Result<String, String> {
    let output = utf8_command("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("failed to run osascript: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// Used by the macOS image-clipboard helpers and by the tests; the other
// platforms don't probe the clipboard for images.
#[cfg(any(target_os = "macos", test))]
fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            let ext = ext.to_ascii_lowercase();
            IMAGE_EXTENSIONS.iter().any(|candidate| *candidate == ext)
        })
        .unwrap_or(false)
}

fn image_extension(name: Option<&str>, mime: Option<&str>, bytes: &[u8]) -> Option<&'static str> {
    if let Some(mime) = mime {
        match mime.to_ascii_lowercase().as_str() {
            "image/png" => return Some("png"),
            "image/jpeg" | "image/jpg" => return Some("jpg"),
            "image/gif" => return Some("gif"),
            "image/webp" => return Some("webp"),
            _ => {}
        }
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some("png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    let ext = Path::new(name?)
        .extension()
        .and_then(|e| e.to_str())?
        .to_ascii_lowercase();
    IMAGE_EXTENSIONS
        .iter()
        .copied()
        .find(|candidate| *candidate == ext)
        .map(|ext| if ext == "jpeg" { "jpg" } else { ext })
}

// Only the macOS AppleScript path-extraction needs this filter; tests cover it too.
#[cfg(any(target_os = "macos", test))]
fn is_valid_clipboard_file_path(path: &str) -> bool {
    // APFS/HFS+ filenames cannot contain ':', which is the HFS path separator.
    // A path with ':' is a sign that AppleScript coerced a URL (e.g. https://...)
    // through POSIX path conversion and mangled it.
    path.starts_with('/') && !path.contains(':')
}

fn unique_paths(paths: Vec<String>) -> Vec<String> {
    let mut unique = Vec::new();
    for path in paths {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    unique
}

fn unique_temp_image_path(ext: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("tempoterm-clipboard-images");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create image temp dir: {e}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system clock is before UNIX epoch: {e}"))?
        .as_nanos();
    for index in 0..100 {
        let path = dir.join(format!("image-{stamp}-{index}.{ext}"));
        if !path.exists() {
            return Ok(path);
        }
    }
    Err("failed to allocate a unique clipboard image path".to_string())
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(target_os = "macos")]
fn applescript_string(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::{image_extension, is_image_path, is_valid_clipboard_file_path, unique_paths};
    use std::path::Path;

    // A GUI (Finder) launch inherits no UTF-8 locale, so helpers like `pbpaste`
    // fall back to the region's legacy encoding (e.g. Big5) for CJK text. The
    // helper command must force a UTF-8 codeset so its output decodes cleanly.
    #[cfg(target_os = "macos")]
    #[test]
    fn helper_command_forces_a_utf8_locale() {
        let cmd = super::utf8_command("pbpaste");
        let forces_utf8 = cmd.get_envs().any(|(k, v)| {
            (k == "LC_ALL" || k == "LC_CTYPE" || k == "LANG")
                && v
                    .and_then(|v| v.to_str())
                    .map(|v| v.to_ascii_uppercase().contains("UTF-8"))
                    .unwrap_or(false)
        });
        assert!(forces_utf8);
    }

    #[test]
    fn detects_image_paths_by_extension() {
        assert!(is_image_path(Path::new("/tmp/a.PNG")));
        assert!(is_image_path(Path::new("/tmp/a.jpeg")));
        assert!(!is_image_path(Path::new("/tmp/a.txt")));
    }

    #[test]
    fn detects_image_extension_from_drop_metadata() {
        assert_eq!(image_extension(None, Some("image/png"), &[]), Some("png"));
        assert_eq!(image_extension(Some("a.jpeg"), None, &[]), Some("jpg"));
        assert_eq!(image_extension(None, None, b"\x89PNG\r\n"), Some("png"));
    }

    #[test]
    fn unique_paths_preserves_first_seen_order() {
        assert_eq!(
            unique_paths(vec!["/a".into(), "/b".into(), "/a".into()]),
            vec!["/a".to_string(), "/b".to_string()]
        );
    }

    #[test]
    fn rejects_url_derived_clipboard_paths() {
        // AppleScript coerces https://github.com/mukiwu/tempo-term to
        // /https/::github.com:mukiwu:tempo-term via HFS↔POSIX path conversion.
        // Colons are the HFS separator and never appear in valid APFS filenames.
        assert!(!is_valid_clipboard_file_path(
            "/https/::github.com:mukiwu:tempo-term"
        ));
        assert!(!is_valid_clipboard_file_path("/http/::example.com:foo:bar"));
    }

    #[test]
    fn accepts_valid_macos_file_paths() {
        assert!(is_valid_clipboard_file_path("/Users/foo/bar.txt"));
        assert!(is_valid_clipboard_file_path("/tmp/image.png"));
        assert!(is_valid_clipboard_file_path(
            "/Applications/Xcode.app/Contents/MacOS/Xcode"
        ));
    }

    #[test]
    fn rejects_relative_and_empty_clipboard_paths() {
        assert!(!is_valid_clipboard_file_path("relative/path.txt"));
        assert!(!is_valid_clipboard_file_path("./local/file.rs"));
        assert!(!is_valid_clipboard_file_path(""));
    }
}
