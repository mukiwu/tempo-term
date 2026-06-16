//! Font discovery module: exposes installed families and Traditional-Chinese
//! monospace detection to the frontend.

mod detect;

pub use detect::{FontInfo, RECOMMENDED_CJK_MONO};

use serde::Serialize;

#[derive(Serialize)]
pub struct FontReport {
    pub fonts: Vec<FontInfo>,
    pub recommended_cjk: Vec<String>,
    pub suggested_cjk_fallback: Option<String>,
    pub has_cjk_fallback: bool,
}

#[tauri::command]
pub fn fonts_report() -> FontReport {
    let fonts = detect::list_fonts();
    let suggested_cjk_fallback = detect::pick_cjk_fallback(&fonts, &RECOMMENDED_CJK_MONO);
    let has_cjk_fallback = detect::has_cjk_fallback(&fonts);
    FontReport {
        fonts,
        recommended_cjk: RECOMMENDED_CJK_MONO.iter().map(|s| s.to_string()).collect(),
        suggested_cjk_fallback,
        has_cjk_fallback,
    }
}
