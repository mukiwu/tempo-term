//! Font discovery module: exposes installed families and Traditional-Chinese
//! monospace detection to the frontend.

mod detect;

pub use detect::{FontInfo, RECOMMENDED_CJK_MONO, RECOMMENDED_ICON_FONTS};

use serde::Serialize;

#[derive(Serialize)]
pub struct FontReport {
    pub fonts: Vec<FontInfo>,
    pub recommended_cjk: Vec<String>,
    pub suggested_cjk_fallback: Option<String>,
    pub has_cjk_fallback: bool,
    pub suggested_icon_fallback: Option<String>,
}

fn build_fonts_report() -> FontReport {
    let fonts = detect::list_fonts();
    let suggested_cjk_fallback = detect::pick_cjk_fallback(&fonts, &RECOMMENDED_CJK_MONO);
    let has_cjk_fallback = detect::has_cjk_fallback(&fonts);
    let suggested_icon_fallback = detect::pick_icon_fallback(&fonts, &RECOMMENDED_ICON_FONTS);
    FontReport {
        fonts,
        recommended_cjk: RECOMMENDED_CJK_MONO.iter().map(|s| s.to_string()).collect(),
        suggested_cjk_fallback,
        has_cjk_fallback,
        suggested_icon_fallback,
    }
}

/// Enumerating and loading every system font takes seconds. As an async command
/// the work runs off the main thread via `spawn_blocking`, so it never freezes
/// the UI during startup (the report just fills in a moment later).
#[tauri::command]
pub async fn fonts_report() -> FontReport {
    tauri::async_runtime::spawn_blocking(build_fonts_report)
        .await
        .unwrap_or_else(|_| FontReport {
            fonts: Vec::new(),
            recommended_cjk: RECOMMENDED_CJK_MONO.iter().map(|s| s.to_string()).collect(),
            suggested_cjk_fallback: None,
            has_cjk_fallback: false,
            suggested_icon_fallback: None,
        })
}
