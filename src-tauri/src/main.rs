#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection, OptionalExtension};
mod profile;
use profile::Profile;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    Emitter, Manager, PhysicalPosition, RunEvent, State, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

struct Db(Mutex<Connection>);

#[derive(Default)]
struct Lifecycle(AtomicBool);

fn migrate(db: &Connection) -> rusqlite::Result<()> {
    let version: u32 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    match version {
        0 => db.execute_batch(include_str!("../migrations/001_initial.sql")),
        1 => db.execute_batch(include_str!("../migrations/002_window_position.sql")),
        2 => Ok(()),
        _ => Err(rusqlite::Error::InvalidQuery),
    }?;
    if version == 0 {
        db.execute_batch(include_str!("../migrations/002_window_position.sql"))?;
    }
    Ok(())
}

#[tauri::command]
fn load_profile(db: State<Db>) -> Result<Option<Profile>, &'static str> {
    let conn = db.0.lock().map_err(|_| "无法读取本地数据")?;
    let raw: Option<String> = conn
        .query_row("SELECT payload FROM profile WHERE id=1", [], |r| r.get(0))
        .optional()
        .map_err(|_| "无法读取本地数据")?;
    let mut profile: Option<Profile> = raw
        .map(|s| serde_json::from_str(&s))
        .transpose()
        .map_err(|_| "本地数据格式无效")?;
    if let Some(data) = &mut profile {
        let migrated = data.migrate_onboarding();
        data.validate()?;
        if migrated {
            let payload = serde_json::to_string(data).map_err(|_| "本地数据格式无效")?;
            conn.execute("UPDATE profile SET payload=?1 WHERE id=1", [payload])
                .map_err(|_| "无法迁移引导状态")?;
        }
    }
    Ok(profile)
}

#[tauri::command]
fn save_profile(db: State<Db>, profile: Profile) -> Result<(), &'static str> {
    let conn = db.0.lock().map_err(|_| "无法保存本地数据")?;
    profile.validate()?;
    let payload = serde_json::to_string(&profile).map_err(|_| "本地数据格式无效")?;
    conn.execute("INSERT INTO profile (id,payload) VALUES (1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", params![payload]).map_err(|_| "无法保存本地数据")?;
    Ok(())
}

fn keep_window_visible(window: &WebviewWindow) {
    let (Ok(position), Ok(size), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    // Keep enough of the title bar on a work area to drag the window.
    let visible = monitors.iter().any(|monitor| {
        let area = monitor.work_area();
        let left = i64::from(area.position.x);
        let top = i64::from(area.position.y);
        let right = left + i64::from(area.size.width);
        let bottom = top + i64::from(area.size.height);
        let x = i64::from(position.x);
        let y = i64::from(position.y);
        let overlap = right.min(x + i64::from(size.width)) - left.max(x);
        overlap >= 100 && y >= top && y + 32 <= bottom
    });
    if !visible && !monitors.is_empty() {
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let area = monitor.work_area();
            let x = area.position.x + (area.size.width.saturating_sub(size.width) / 2) as i32;
            let y = area.position.y + (area.size.height.saturating_sub(size.height) / 2) as i32;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = window.center();
        }
    }
}

fn show_main_window(app: &tauri::AppHandle, open_settings: bool) {
    let handle = app.clone();
    // Serialize lookup, creation and activation on the native event loop.
    let _ = app.run_on_main_thread(move || {
        if handle.state::<Lifecycle>().0.load(Ordering::Acquire) {
            return;
        }
        let window = handle.get_webview_window("main").or_else(|| {
            let config = handle
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")?;
            WebviewWindowBuilder::from_config(&handle, config)
                .ok()?
                .build()
                .ok()
        });
        if let Some(window) = window {
            #[cfg(target_os = "macos")]
            let _ = handle.show();
            let _ = window.show();
            let _ = window.unminimize();
            keep_window_visible(&window);
            let _ = window.set_focus();
            if open_settings {
                let _ = handle.emit("open-settings", ());
            }
        }
    });
}

fn quit(app: &tauri::AppHandle) {
    app.state::<Lifecycle>().0.store(true, Ordering::Release);
    // Profile writes are synchronous SQLite commits under this lock.
    if let Ok(write) = app.state::<Db>().0.lock() {
        drop(write);
    }
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .manage(Lifecycle::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main_window(app, false)))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(tauri::generate_handler![load_profile, save_profile])
        .setup(|app| {
            let dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = Connection::open(dir.join("earnings.sqlite3"))?;
            migrate(&conn)?;
            let position: Option<(i32, i32)> = conn
                .query_row("SELECT x, y FROM window_position WHERE id=1", [], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .optional()?;
            app.manage(Db(Mutex::new(conn)));
            if let (Some(window), Some((x, y))) = (app.get_webview_window("main"), position) {
                let _ = window.set_position(PhysicalPosition::new(x, y));
                keep_window_visible(&window);
            }
            let open = MenuItem::with_id(app,"open","打开主界面",true,None::<&str>)?;
            let settings = MenuItem::with_id(app,"settings","设置",true,None::<&str>)?;
            let exit = MenuItem::with_id(app,"exit","退出上班鼓励器",true,None::<&str>)?;
            let menu = Menu::with_items(app,&[&open,&settings,&exit])?;
            #[cfg(target_os = "macos")]
            let icon = include_bytes!("../../assets/logo/tray-dark-32.png");
            #[cfg(not(target_os = "macos"))]
            let icon = include_bytes!("../../assets/logo/app-icon-24.png");
            TrayIconBuilder::new()
                .icon(tauri::image::Image::from_bytes(icon)?)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("上班鼓励器")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app,event| match event.id().as_ref() {
                    "open" => show_main_window(app, false),
                    "settings" => show_main_window(app, true),
                    "exit" => quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray,event| {
                    if let TrayIconEvent::Click {button:MouseButton::Left,button_state:MouseButtonState::Up,..} = event { show_main_window(tray.app_handle(), false); }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window,event| {
            match event {
                WindowEvent::CloseRequested { api, .. } if !window.state::<Lifecycle>().0.load(Ordering::Acquire) => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                WindowEvent::Moved(position) => {
                    if let Some(db) = window.try_state::<Db>() {
                        if let Ok(conn) = db.0.lock() {
                            let _ = conn.execute(
                                "INSERT INTO window_position VALUES (1,?1,?2) ON CONFLICT(id) DO UPDATE SET x=excluded.x,y=excluded.y",
                                params![position.x,position.y],
                            );
                        }
                    }
                }
                WindowEvent::Focused(true) | WindowEvent::ScaleFactorChanged { .. } => {
                    if let Some(main) = window.get_webview_window("main") {
                        keep_window_visible(&main);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("无法启动上班鼓励器")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main_window(app, false),
            RunEvent::ExitRequested { .. } => {
                app.state::<Lifecycle>().0.store(true, Ordering::Release);
                if let Ok(write) = app.state::<Db>().0.lock() {
                    drop(write);
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_preserves_profile_on_reopen() {
        let path =
            std::env::temp_dir().join(format!("shangban-test-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Connection::open(&path).unwrap();
        db.execute_batch(include_str!("../migrations/001_initial.sql"))
            .unwrap();
        let sample = r#"{
            "settings":{"salaryCents":1260000,"payday":10,"weekdays":[1,2,3,4,5],
                        "shiftStart":"09:00","shiftEnd":"18:00","lunchStart":"12:00","lunchEnd":"13:00"},
            "pauses":[{"dateKey":"2026-11-04","startedAt":1793757600000,"endedAt":null}],
            "commissions":[{"id":"fixture","dateKey":"2026-11-03","amountCents":20000,"note":""}],
            "overrides":{"2026-11-03":"off"},
            "pinned":false
        }"#;
        db.execute("INSERT INTO profile VALUES (1,?1)", [sample])
            .unwrap();
        drop(db);
        let db = Connection::open(&path).unwrap();
        migrate(&db).unwrap();
        let saved: String = db
            .query_row("SELECT payload FROM profile", [], |r| r.get(0))
            .unwrap();
        assert_eq!(saved, sample);
        let mut profile: Profile = serde_json::from_str(&saved).unwrap();
        assert!(profile.migrate_onboarding());
        assert!(profile.validate().is_ok());
        assert!(!profile.migrate_onboarding());
        let migrated = serde_json::to_value(profile).unwrap();
        assert_eq!(migrated["onboardingCompleted"], true);
        let original: serde_json::Value = serde_json::from_str(&saved).unwrap();
        for field in ["settings", "pauses", "commissions", "overrides", "pinned"] {
            // The codec may add a default attendance amount and omit an empty note.
            if field == "settings" {
                assert_eq!(
                    migrated[field]["salaryCents"],
                    original[field]["salaryCents"]
                );
                assert_eq!(migrated[field]["weekdays"], original[field]["weekdays"]);
            } else if field == "commissions" {
                assert_eq!(
                    migrated[field][0]["amountCents"],
                    original[field][0]["amountCents"]
                );
            } else {
                assert_eq!(migrated[field], original[field]);
            }
        }

        let mut seeded = original.clone();
        seeded["settings"]["salaryCents"] = 0.into();
        let mut seeded: Profile = serde_json::from_value(seeded).unwrap();
        assert!(seeded.migrate_onboarding());
        seeded.validate().unwrap();
        assert_eq!(
            serde_json::to_value(seeded).unwrap()["onboardingCompleted"],
            false
        );

        let mut unfinished = original;
        unfinished["onboardingCompleted"] = false.into();
        let mut unfinished: Profile = serde_json::from_value(unfinished).unwrap();
        assert!(!unfinished.migrate_onboarding());
        assert_eq!(
            serde_json::to_value(unfinished).unwrap()["onboardingCompleted"],
            false
        );
        let version: u32 = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);
        migrate(&db).unwrap();
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
}
