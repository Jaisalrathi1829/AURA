// Keep the console window from appearing behind the overlay in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aura_lib::run()
}
