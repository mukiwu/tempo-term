//! System font discovery focused on what a terminal needs: which families are
//! monospace, and which can render Traditional Chinese.

use font_kit::font::Font;
use font_kit::source::SystemSource;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FontInfo {
    pub family: String,
    pub monospace: bool,
    /// True when the family can render representative CJK ideographs.
    pub has_cjk: bool,
}

/// Curated, ordered preference of Traditional-Chinese-friendly families. Ideal
/// CJK monospace fonts come first; native Traditional Chinese fonts (PingFang
/// TC, Heiti TC) follow. They are proportional, but xterm lays glyphs out by
/// cell with the Unicode 11 width tables, so they still serve as good
/// fallbacks. The first one actually installed becomes the default fallback.
pub const RECOMMENDED_CJK_MONO: [&str; 6] = [
    "Sarasa Mono TC",
    "Noto Sans Mono CJK TC",
    "Sarasa Mono SC",
    "Noto Sans Mono CJK SC",
    "PingFang TC",
    "Heiti TC",
];

/// Representative ideographs spanning common usage. A real CJK font covers all
/// of these; symbol fonts with a stray glyph do not.
const CJK_PROBES: [char; 3] = ['中', '永', '體'];

fn is_cjk_capable(font: &Font) -> bool {
    CJK_PROBES
        .iter()
        .all(|&c| font.glyph_for_char(c).map(|g| g != 0).unwrap_or(false))
}

/// Enumerate every installed family with terminal-relevant flags.
pub fn list_fonts() -> Vec<FontInfo> {
    let source = SystemSource::new();
    let families = source.all_families().unwrap_or_default();

    let mut fonts: Vec<FontInfo> = families
        .into_iter()
        .filter_map(|family| {
            let handle = source.select_family_by_name(&family).ok()?;
            let first = handle.fonts().first()?.load().ok()?;
            Some(FontInfo {
                family,
                monospace: first.is_monospace(),
                has_cjk: is_cjk_capable(&first),
            })
        })
        .collect();

    fonts.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()));
    fonts.dedup();
    fonts
}

/// Pick the best available Traditional-Chinese fallback. A CJK font need not be
/// monospace to serve as a terminal fallback because xterm positions glyphs by
/// cell. Preference order: a `priority` family that is installed and
/// CJK-capable, then any CJK monospace font, then any CJK font at all.
pub fn pick_cjk_fallback(fonts: &[FontInfo], priority: &[&str]) -> Option<String> {
    for &name in priority {
        if fonts.iter().any(|f| f.family == name && f.has_cjk) {
            return Some(name.to_string());
        }
    }
    if let Some(f) = fonts.iter().find(|f| f.monospace && f.has_cjk) {
        return Some(f.family.clone());
    }
    fonts.iter().find(|f| f.has_cjk).map(|f| f.family.clone())
}

/// Whether the system has any family that can render CJK as a terminal
/// fallback. Drives the install hint in settings when it returns false.
pub fn has_cjk_fallback(fonts: &[FontInfo]) -> bool {
    fonts.iter().any(|f| f.has_cjk)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn font(family: &str, monospace: bool, has_cjk: bool) -> FontInfo {
        FontInfo {
            family: family.to_string(),
            monospace,
            has_cjk,
        }
    }

    #[test]
    fn prefers_first_installed_priority_font() {
        let fonts = vec![
            font("Menlo", true, false),
            font("Noto Sans Mono CJK TC", true, true),
            font("Sarasa Mono TC", true, true),
        ];
        // Sarasa appears first in RECOMMENDED_CJK_MONO, so it wins over Noto.
        assert_eq!(
            pick_cjk_fallback(&fonts, &RECOMMENDED_CJK_MONO),
            Some("Sarasa Mono TC".to_string())
        );
    }

    #[test]
    fn prefers_cjk_monospace_over_other_cjk_when_no_priority_match() {
        let fonts = vec![
            font("Menlo", true, false),
            font("Some Proportional CJK", false, true),
            font("Some Custom CJK Mono", true, true),
        ];
        assert_eq!(
            pick_cjk_fallback(&fonts, &RECOMMENDED_CJK_MONO),
            Some("Some Custom CJK Mono".to_string())
        );
    }

    #[test]
    fn returns_none_when_no_cjk_font_available() {
        let fonts = vec![font("Menlo", true, false), font("Arial", false, false)];
        assert_eq!(pick_cjk_fallback(&fonts, &RECOMMENDED_CJK_MONO), None);
        assert!(!has_cjk_fallback(&fonts));
    }

    #[test]
    fn allows_native_proportional_cjk_font_as_fallback() {
        // PingFang TC is proportional but renders Traditional Chinese well in
        // xterm's cell layout, so it is a valid fallback.
        let fonts = vec![font("Menlo", true, false), font("PingFang TC", false, true)];
        assert_eq!(
            pick_cjk_fallback(&fonts, &RECOMMENDED_CJK_MONO),
            Some("PingFang TC".to_string())
        );
    }

    #[test]
    fn detects_presence_of_cjk_fallback() {
        let fonts = vec![font("PingFang TC", false, true)];
        assert!(has_cjk_fallback(&fonts));
    }

    #[test]
    fn enumerates_real_system_fonts() {
        let fonts = list_fonts();
        assert!(!fonts.is_empty(), "system should expose at least one font");

        let mono = fonts.iter().filter(|f| f.monospace).count();
        let cjk = fonts.iter().filter(|f| f.has_cjk).count();
        let cjk_mono = fonts.iter().filter(|f| f.monospace && f.has_cjk).count();
        let suggested = pick_cjk_fallback(&fonts, &RECOMMENDED_CJK_MONO);
        eprintln!(
            "[fonts] total={} mono={} cjk={} cjk_mono={} suggested={:?}",
            fonts.len(),
            mono,
            cjk,
            cjk_mono,
            suggested
        );
    }
}
