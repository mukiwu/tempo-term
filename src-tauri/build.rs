use std::env;

fn main() {
    // fm-rs (the Apple Intelligence bridge) links FoundationModels.framework,
    // which only exists on macOS 26+. A hard link makes dyld refuse to start
    // the app on macOS 15 and earlier ("Library not loaded") before main()
    // runs. Weak-link the framework instead so the binary loads everywhere;
    // modules/ai gates every call into fm-rs behind a runtime OS check.
    // Plain rustc-link-arg (not -bins) so the test harness loads there too.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,FoundationModels");
    }
    tauri_build::build()
}
