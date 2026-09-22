//! The one way into `fm-rs`, and the check that has to come first.
//!
//! `FoundationModels.framework` ships with macOS 26 and is weak-linked (see
//! `build.rs`), which is what lets the app start at all on an older macOS: a
//! strong link made dyld refuse the binary before `main()` ever ran (#448).
//!
//! The other half of weak linking is that on such a Mac every one of the
//! framework's symbols resolves to null, and `fm_rs::SystemLanguageModel::new`
//! calls into one on its first line. So `fm_rs` is named here and nowhere
//! else: every path into it starts at a model handle, the only handle comes
//! from `system_model`, and that asks the question first -- which is how a
//! caller added later cannot forget to ask it. Gating each entry point
//! separately is what left the Ports panel's two commands calling in
//! unguarded while the chat provider beside them was covered.

/// What a caller gets back when the framework is not on this Mac.
pub(crate) const UNSUPPORTED: &str = "Apple Intelligence requires macOS 26 or later.";

/// A handle to the on-device model, or `UNSUPPORTED` on a Mac without it.
pub(crate) fn system_model() -> Result<fm_rs::SystemLanguageModel, String> {
    if !runtime_present() {
        return Err(UNSUPPORTED.to_string());
    }
    fm_rs::SystemLanguageModel::new().map_err(|e| e.to_string())
}

/// One question to the model, and its answer.
///
/// Empty `instructions` opens a plain session rather than one instructed with
/// nothing, which the framework reads as an empty system prompt.
pub(crate) fn respond(
    model: &fm_rs::SystemLanguageModel,
    instructions: &str,
    prompt: &str,
) -> Result<String, String> {
    let session = if instructions.is_empty() {
        fm_rs::Session::new(model)
    } else {
        fm_rs::Session::with_instructions(model, instructions)
    }
    .map_err(|e| e.to_string())?;
    let response = session
        .respond(prompt, &fm_rs::GenerationOptions::default())
        .map_err(|e| e.to_string())?;
    Ok(response.content().to_string())
}

/// Whether the framework is on this Mac.
///
/// Answered by OS version rather than by looking the framework up: it arrived
/// in macOS 26 and has been there since, so the version says the same thing
/// for one `sysctl` read -- `sysinfo` reads `kern.osproductversion`, which is
/// the product version and not Darwin's.
pub(crate) fn runtime_present() -> bool {
    sysinfo::System::os_version()
        .as_deref()
        .is_some_and(supports_foundation_models)
}

/// `version` is the product version sysinfo reports, e.g. "15.7.9" or "26.1".
fn supports_foundation_models(version: &str) -> bool {
    version
        .trim()
        .split('.')
        .next()
        .and_then(|major| major.parse::<u32>().ok())
        .is_some_and(|major| major >= 26)
}

#[cfg(test)]
mod tests {
    use super::supports_foundation_models;

    /// The door stays the only door.
    ///
    /// This is the shape of the bug rather than a style rule: an `fm_rs` call
    /// anywhere else is a call that did not ask whether the framework is on
    /// this Mac, and on macOS 15 that is a null symbol and a dead app. The
    /// Ports panel's two commands were exactly that, added months after the
    /// chat provider they sat beside.
    #[test]
    fn fm_rs_is_named_in_this_module_and_nowhere_else() {
        fn walk(dir: &std::path::Path, found: &mut Vec<String>) {
            for entry in std::fs::read_dir(dir).expect("read src") {
                let path = entry.expect("dir entry").path();
                if path.is_dir() {
                    walk(&path, found);
                } else if path.extension().is_some_and(|ext| ext == "rs")
                    && path.file_name().is_some_and(|name| name != "foundation_models.rs")
                    && std::fs::read_to_string(&path)
                        .expect("read source")
                        .contains("fm_rs")
                {
                    found.push(path.display().to_string());
                }
            }
        }

        let mut found = Vec::new();
        walk(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut found,
        );
        assert!(
            found.is_empty(),
            "fm_rs reached without the macOS 26 check in: {found:?}",
        );
    }

    #[test]
    fn foundation_models_needs_macos_26() {
        assert!(!supports_foundation_models("15.7.9"));
        assert!(!supports_foundation_models("14.0"));
        assert!(supports_foundation_models("26.0"));
        assert!(supports_foundation_models("26.1 "));
        assert!(supports_foundation_models("27.0.1"));
        assert!(!supports_foundation_models(""));
        assert!(!supports_foundation_models("Version 26"));
    }
}
