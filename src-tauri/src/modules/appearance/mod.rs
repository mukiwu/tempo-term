//! App-managed custom background images.
//!
//! The frontend may only ask us to import a user-selected image. The source is
//! validated and copied into a fixed app-data directory; removal accepts no
//! path, so this IPC surface can never become a general-purpose file writer or
//! deleter.

use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::Manager;

const APPEARANCE_DIR: &str = "appearance";
const BACKGROUND_PREFIX: &str = "background-";
const MAX_BACKGROUND_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
static UNIQUE_SUFFIX: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, PartialEq, Eq)]
pub enum AppearanceError {
    InvalidFile,
    UnsupportedFormat,
    FileTooLarge,
    StorageUnavailable,
}

impl fmt::Display for AppearanceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidFile => "The selected image could not be read.",
            Self::UnsupportedFormat => "Choose a PNG, JPEG, or WebP image.",
            Self::FileTooLarge => "Choose an image no larger than 20 MB.",
            Self::StorageUnavailable => "The background image could not be saved.",
        };
        formatter.write_str(message)
    }
}

impl serde::Serialize for AppearanceError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let code = match self {
            Self::InvalidFile => "invalidFile",
            Self::UnsupportedFormat => "unsupportedFormat",
            Self::FileTooLarge => "fileTooLarge",
            Self::StorageUnavailable => "storageUnavailable",
        };
        serializer.serialize_str(code)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ImageFormat {
    Png,
    Jpeg,
    WebP,
}

impl ImageFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::WebP => "webp",
        }
    }
}

fn format_from_extension(path: &Path) -> Option<ImageFormat> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some(ImageFormat::Png),
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "webp" => Some(ImageFormat::WebP),
        _ => None,
    }
}

fn format_from_header(header: &[u8]) -> Option<ImageFormat> {
    if header.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(ImageFormat::Png);
    }
    if header.starts_with(b"\xff\xd8\xff") {
        return Some(ImageFormat::Jpeg);
    }
    if header.len() >= 12 && header.starts_with(b"RIFF") && &header[8..12] == b"WEBP" {
        return Some(ImageFormat::WebP);
    }
    None
}

fn unique_filename(format: ImageFormat) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = UNIQUE_SUFFIX.fetch_add(1, Ordering::Relaxed);
    format!(
        "{BACKGROUND_PREFIX}{nanos}-{}-{sequence}.{}",
        std::process::id(),
        format.extension()
    )
}

fn is_managed_background(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if !name.starts_with(BACKGROUND_PREFIX) {
        return false;
    }
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase()),
        Some(extension) if matches!(extension.as_str(), "png" | "jpg" | "webp")
    )
}

fn remove_file_with_retry(path: &Path) -> Result<(), AppearanceError> {
    const MAX_ATTEMPTS: usize = 3;
    for attempt in 0..MAX_ATTEMPTS {
        match fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error)
                if attempt + 1 < MAX_ATTEMPTS
                    && (error.kind() == std::io::ErrorKind::PermissionDenied
                        || error.raw_os_error() == Some(32)) =>
            {
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return Err(AppearanceError::StorageUnavailable),
        }
    }
    Err(AppearanceError::StorageUnavailable)
}

fn remove_managed_backgrounds(dir: &Path, keep: Option<&Path>) -> Result<(), AppearanceError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(AppearanceError::StorageUnavailable),
    };

    for entry in entries {
        let entry = entry.map_err(|_| AppearanceError::StorageUnavailable)?;
        let path = entry.path();
        if keep.is_some_and(|kept| kept == path) || !is_managed_background(&path) {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|_| AppearanceError::StorageUnavailable)?;
        if metadata.is_file() {
            remove_file_with_retry(&path)?;
        }
    }
    Ok(())
}

fn save_background_image_into(
    source_path: &Path,
    appearance_dir: &Path,
    max_bytes: u64,
) -> Result<PathBuf, AppearanceError> {
    let source_path = fs::canonicalize(source_path).map_err(|_| AppearanceError::InvalidFile)?;
    let expected_format =
        format_from_extension(&source_path).ok_or(AppearanceError::UnsupportedFormat)?;
    let mut source = File::open(&source_path).map_err(|_| AppearanceError::InvalidFile)?;
    let metadata = source
        .metadata()
        .map_err(|_| AppearanceError::InvalidFile)?;
    if !metadata.is_file() {
        return Err(AppearanceError::InvalidFile);
    }
    if metadata.len() > max_bytes {
        return Err(AppearanceError::FileTooLarge);
    }

    let mut header = Vec::with_capacity(16);
    std::io::Read::by_ref(&mut source)
        .take(16)
        .read_to_end(&mut header)
        .map_err(|_| AppearanceError::InvalidFile)?;
    let detected_format = format_from_header(&header).ok_or(AppearanceError::UnsupportedFormat)?;
    if detected_format != expected_format {
        return Err(AppearanceError::UnsupportedFormat);
    }
    source
        .seek(SeekFrom::Start(0))
        .map_err(|_| AppearanceError::InvalidFile)?;

    fs::create_dir_all(appearance_dir).map_err(|_| AppearanceError::StorageUnavailable)?;
    let filename = unique_filename(detected_format);
    let destination = appearance_dir.join(filename);
    let temporary = destination.with_extension("tmp");
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| AppearanceError::StorageUnavailable)?;

    let copied = std::io::copy(&mut source.take(max_bytes + 1), &mut output).map_err(|_| {
        let _ = fs::remove_file(&temporary);
        AppearanceError::StorageUnavailable
    })?;
    if copied > max_bytes {
        let _ = fs::remove_file(&temporary);
        return Err(AppearanceError::FileTooLarge);
    }
    output.flush().map_err(|_| {
        let _ = fs::remove_file(&temporary);
        AppearanceError::StorageUnavailable
    })?;
    output.sync_all().map_err(|_| {
        let _ = fs::remove_file(&temporary);
        AppearanceError::StorageUnavailable
    })?;
    drop(output);
    fs::rename(&temporary, &destination).map_err(|_| {
        let _ = fs::remove_file(&temporary);
        AppearanceError::StorageUnavailable
    })?;

    // The new image is already complete and addressable. Only now remove the
    // previous managed file, so a failed import never destroys the active one.
    // Cleanup is best-effort after commit. A stale managed file is preferable
    // to reporting a failed save after the frontend has already received a
    // valid replacement path.
    let _ = remove_managed_backgrounds(appearance_dir, Some(&destination));
    Ok(destination)
}

#[tauri::command]
pub async fn appearance_save_background_image(
    source_path: String,
    app: tauri::AppHandle,
) -> Result<String, AppearanceError> {
    let appearance_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppearanceError::StorageUnavailable)?
        .join(APPEARANCE_DIR);
    tauri::async_runtime::spawn_blocking(move || {
        save_background_image_into(
            Path::new(&source_path),
            &appearance_dir,
            MAX_BACKGROUND_IMAGE_BYTES,
        )
        .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| AppearanceError::StorageUnavailable)?
}

#[tauri::command]
pub async fn appearance_remove_background_image(
    app: tauri::AppHandle,
) -> Result<(), AppearanceError> {
    let appearance_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppearanceError::StorageUnavailable)?
        .join(APPEARANCE_DIR);
    tauri::async_runtime::spawn_blocking(move || remove_managed_backgrounds(&appearance_dir, None))
        .await
        .map_err(|_| AppearanceError::StorageUnavailable)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "tempoterm-appearance-test-{}-{name}",
            std::process::id()
        ))
    }

    fn write_test_file(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn detects_supported_image_headers() {
        assert_eq!(
            format_from_header(b"\x89PNG\r\n\x1a\nrest"),
            Some(ImageFormat::Png)
        );
        assert_eq!(
            format_from_header(b"\xff\xd8\xffrest"),
            Some(ImageFormat::Jpeg)
        );
        assert_eq!(
            format_from_header(b"RIFF1234WEBPrest"),
            Some(ImageFormat::WebP)
        );
        assert_eq!(format_from_header(b"<svg></svg>"), None);
    }

    #[test]
    fn imports_a_supported_image_and_removes_the_previous_one() {
        let root = test_dir("replace");
        let _ = fs::remove_dir_all(&root);
        let source_dir = root.join("sources");
        let appearance_dir = root.join("appearance");
        let first = write_test_file(&source_dir, "first.png", b"\x89PNG\r\n\x1a\nfirst");
        let second = write_test_file(&source_dir, "second.jpg", b"\xff\xd8\xffsecond");

        let first_saved = save_background_image_into(&first, &appearance_dir, 1024).unwrap();
        assert!(first_saved.exists());
        let second_saved = save_background_image_into(&second, &appearance_dir, 1024).unwrap();
        assert!(second_saved.exists());
        assert!(!first_saved.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_an_extension_that_does_not_match_the_header() {
        let root = test_dir("mismatch");
        let _ = fs::remove_dir_all(&root);
        let source = write_test_file(&root, "not-really.png", b"\xff\xd8\xffjpeg");

        let result = save_background_image_into(&source, &root.join("appearance"), 1024);
        assert_eq!(result, Err(AppearanceError::UnsupportedFormat));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn imports_a_unicode_path_with_spaces() {
        let root = test_dir("unicode-path");
        let _ = fs::remove_dir_all(&root);
        let source = write_test_file(
            &root.join("有 空白"),
            "我的 背景.webp",
            b"RIFF1234WEBPpayload",
        );

        let saved = save_background_image_into(&source, &root.join("appearance"), 1024).unwrap();
        assert!(saved.exists());
        assert_eq!(
            saved.extension().and_then(|value| value.to_str()),
            Some("webp")
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_a_directory_instead_of_treating_it_as_an_image() {
        let root = test_dir("directory");
        let _ = fs::remove_dir_all(&root);
        let directory_with_extension = root.join("folder.png");
        fs::create_dir_all(&directory_with_extension).unwrap();

        let result =
            save_background_image_into(&directory_with_extension, &root.join("appearance"), 1024);
        assert_eq!(result, Err(AppearanceError::InvalidFile));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn failed_replacement_preserves_the_current_managed_image() {
        let root = test_dir("preserve");
        let _ = fs::remove_dir_all(&root);
        let appearance_dir = root.join("appearance");
        let first = write_test_file(&root, "first.png", b"\x89PNG\r\n\x1a\nfirst");
        let invalid = write_test_file(&root, "invalid.png", b"\xff\xd8\xfffake");
        let current = save_background_image_into(&first, &appearance_dir, 1024).unwrap();

        let result = save_background_image_into(&invalid, &appearance_dir, 1024);
        assert_eq!(result, Err(AppearanceError::UnsupportedFormat));
        assert!(current.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn enforces_the_actual_copy_limit() {
        let root = test_dir("oversize");
        let _ = fs::remove_dir_all(&root);
        let source = write_test_file(&root, "large.png", b"\x89PNG\r\n\x1a\npayload");

        let result = save_background_image_into(&source, &root.join("appearance"), 8);
        assert_eq!(result, Err(AppearanceError::FileTooLarge));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn removal_never_touches_unmanaged_files() {
        let root = test_dir("remove");
        let _ = fs::remove_dir_all(&root);
        let managed = write_test_file(&root, "background-1.png", b"managed");
        let unrelated = write_test_file(&root, "keep.png", b"unrelated");
        let in_flight = write_test_file(&root, "background-2.tmp", b"in flight");

        remove_managed_backgrounds(&root, None).unwrap();
        assert!(!managed.exists());
        assert!(unrelated.exists());
        assert!(in_flight.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn removing_an_already_missing_file_is_successful() {
        let root = test_dir("remove-missing");
        let _ = fs::remove_dir_all(&root);
        remove_file_with_retry(&root.join("background-missing.png")).unwrap();
    }
}
