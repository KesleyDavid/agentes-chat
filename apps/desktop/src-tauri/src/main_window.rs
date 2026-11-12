//! The main window: the server open now, inside the app (agentes.chat, or a server of the person's own,
//! `servers.rs`). It loads the server's pages itself, so every change to the web shows here at once, and
//! gets no access to this computer: no app command, only dragging the window by its title bar and `this_mac`
//! (capabilities/main.json, and the same one added at runtime for another server's origin). Links to
//! anywhere else open in the person's browser, and so does social sign-in (Google and Apple refuse embedded
//! web views): the site hands the session back through `/desktop/sign-in` and `/desktop/signed-in`
//! (apps/server desktop-sign-in.ts). What the site may ask of this computer is `this_mac` (see `Bridge`).

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, Theme, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_notification::{Action, ActionType, NotificationExt};
use tauri_plugin_opener::OpenerExt;

use crate::servers;

pub const LABEL: &str = "main";

/// The site sends social sign-in here: it must open in the browser, never in the window.
const BROWSER_SIGN_IN: &str = "/desktop/sign-in";
/// The site comes here once the browser handed the session over: the window comes to the front.
const SIGNED_IN: &str = "/desktop/signed-in";
/// The help pages: background reading opens in the browser, never in place of the conversation.
const HELP: &str = "/help/";
/// The server's page that posts its GitHub App manifest to github.com (ADR 0156): the window would hand that post to
/// the browser without its form, so the whole page opens there.
const GITHUB_APP_MANIFEST: &str = "/api/app/github-app/manifest/start";
/// Cloudflare Turnstile, the bot check of the site's sign-in pages: its frame loads inside the page. On macOS and
/// Linux the web view asks about frames too, so sent outside it would open a tab on every sign-in page and never
/// load in the window.
const BOT_CHECK_HOST: &str = "challenges.cloudflare.com";

/// The server the window loads: the one open now (`servers.json`); None before the first run chose one.
pub fn site(app: &AppHandle) -> Option<Url> {
    servers::current(app)
}

fn same_site(url: &Url, site: &Url) -> bool {
    url.scheme() == site.scheme()
        && url.host_str() == site.host_str()
        && url.port_or_known_default() == site.port_or_known_default()
}

/// This computer's system, as `window.__agentesDesktop.platform` names it for the site.
pub const PLATFORM: &str = if cfg!(target_os = "macos") {
    "mac"
} else if cfg!(target_os = "windows") {
    "windows"
} else {
    "linux"
};

/// Whether agents may work on this computer for `origin`: any server elsewhere, agentes.chat included (people bring
/// their own computers there too), never a server on this computer itself, the server here included at its
/// Tailscale address (`server_here`: its own computer is set up with it).
/// Another server on this computer at its address for people is `discover::served_here`, which asks it.
pub fn agents_here(origin: &str, server_here: bool) -> bool {
    !servers::is_loopback(origin) && !server_here
}

/// What a navigation in the window does.
#[derive(Debug, PartialEq)]
enum Route {
    /// Stays in the window.
    Stay,
    /// Stays, and the window comes to the front (signed in from the browser).
    Front,
    /// Opens in the person's browser (or their mail app) instead.
    Outside,
    /// Goes nowhere: a scheme the system would hand to some other app (file:, smb:, an app's own links), which a
    /// page or a link someone wrote must never be able to launch.
    Drop,
}

/// Schemes the system may open for the window: the web, mail, and this app's own links (`deep_link.rs`
/// checks those again when they come back).
fn outside_or_drop(url: &Url) -> Route {
    match url.scheme() {
        "http" | "https" | "mailto" | crate::deep_link::SCHEME => Route::Outside,
        _ => Route::Drop,
    }
}

fn route(url: &Url, site: &Url) -> Route {
    match url.scheme() {
        "http" | "https" if same_site(url, site) => match url.path() {
            BROWSER_SIGN_IN | GITHUB_APP_MANIFEST => Route::Outside,
            SIGNED_IN => Route::Front,
            path if path.starts_with(HELP) => Route::Outside,
            _ => Route::Stay,
        },
        "https" if url.host_str() == Some(BOT_CHECK_HOST) && url.port().is_none() => Route::Stay,
        "http" | "https" => Route::Outside,
        // The site's own previews (sandboxed HTML, PDFs) load from these.
        "blob" | "data" | "about" => Route::Stay,
        _ => outside_or_drop(url),
    }
}

/// The route for `url` against the server open now; with none, nothing stays in the window.
fn route_now(app: &AppHandle, url: &Url) -> Route {
    site(app).map(|s| route(url, &s)).unwrap_or_else(|| outside_or_drop(url))
}

fn open_outside(app: &AppHandle, url: &Url) {
    if url.as_str().len() > 8192 || outside_or_drop(url) == Route::Drop {
        return;
    }
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
}

/// What the window shows before the site paints: the site's own background (packages/ui tokens.css `--side`),
/// never the web view's white. Follows the system's light/dark (lib.rs updates it on `ThemeChanged`).
pub fn backdrop(theme: Theme) -> Color {
    match theme {
        Theme::Dark => Color(10, 10, 9, 255),
        _ => Color(248, 248, 246, 255),
    }
}

/// Where `url` goes inside the page that is already there: the site's router (`__agentesNavigate`,
/// apps/web __root.tsx) moves without loading the page again; before the site is up, a plain load.
fn go_in_page(url: &Url) -> Option<String> {
    let mut path = url.path().to_string();
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }
    if let Some(fragment) = url.fragment() {
        path.push('#');
        path.push_str(fragment);
    }
    if path == "/" {
        return None; // the root: only the window comes, as the person left it
    }
    let path = serde_json::to_string(&path).ok()?;
    Some(format!("(window.__agentesNavigate || ((p) => location.assign(p)))({path})"))
}

/// The window on `url`, a page of a server in the list, which becomes the one open now. Another server than
/// the page shows, or a page whose fragment carries a one-time secret (the router keeps fragments in its
/// history), loads as a whole page.
pub fn show_url(app: &AppHandle, url: Url) -> Result<(), String> {
    let url = crate::local_server::page_for_people(app, url);
    let origin = url.origin().ascii_serialization();
    if !servers::get(app).servers.contains(&origin) {
        return Err("not a server of this app".into());
    }
    if site(app).map(|s| s.origin().ascii_serialization()).as_deref() != Some(origin.as_str()) {
        servers::choose(app, &origin);
    }
    if let Some(page) = app.get_webview(LABEL) {
        let shows_it = page.url().is_ok_and(|u| same_site(&u, &url));
        if !shows_it || url.fragment().is_some() {
            page.navigate(url).map_err(|e| e.to_string())?;
            return front(app);
        }
    }
    open(app, Some(url))
}

/// The server here left the address `old` (its port was taken): a window still on it goes to the server open
/// now, shown or not, so it never stays on whatever answers at the old port.
pub fn follow_move(app: &AppHandle, old: &str) {
    let Some(page) = app.get_webview(LABEL) else { return };
    if page.url().is_ok_and(|u| u.origin().ascii_serialization() == old) {
        if let Some(site) = site(app) {
            let _ = page.navigate(site);
        }
    }
}

/// Shows the window (made on first use), on `url` when given (a page of the server open now).
pub fn open(app: &AppHandle, url: Option<Url>) -> Result<(), String> {
    let site = site(app).ok_or("no server chosen yet")?;
    let url = url.filter(|u| same_site(u, &site));
    // The window holds two web views (the site, and the app's cover over it), so it is found by its parts.
    // Already open: never a reload (where the person was, drafts, scroll stay), only the route moves.
    if let Some(page) = app.get_webview(LABEL) {
        if let Some(js) = url.as_ref().and_then(go_in_page) {
            page.eval(js).map_err(|e| e.to_string())?;
        }
        return front(app);
    }

    let on_nav = app.clone();
    let on_new = app.clone();
    let on_download = app.clone();
    let on_load = app.clone();
    let on_title = app.clone();
    let saved = crate::window_state::load(app);
    let version = app.package_info().version.to_string();
    // The popover is made at start, so it already knows the system's appearance.
    let theme = app
        .get_webview_window("popover")
        .and_then(|w| w.theme().ok())
        .unwrap_or(Theme::Light);
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url.unwrap_or_else(|| site.clone())))
        .title("agentes.chat")
        .min_inner_size(960.0, 600.0)
        // As the person left it (window_state.rs), on a screen that is still there.
        .inner_size(saved.width.unwrap_or(1240.0), saved.height.unwrap_or(800.0))
        .prevent_overflow()
        // Two web views share the window (the site and the cover): each follows its size.
        .auto_resize()
        // Files dragged from Finder (into a conversation, the Drive) and drags inside the page go to the site;
        // Tauri's own drop handling would take every drag first and the page would get nothing.
        .disable_drag_drop_handler()
        .background_color(backdrop(theme))
        // Hidden, the page keeps running (macOS 14+), as Slack's: conversations stay live, the Dock badge
        // stays right, and coming back finds it as it was.
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        // The window's name is the page's ("#loja · Acme"): the Window menu, Mission Control, VoiceOver.
        .on_document_title_changed(move |_, title| {
            if let Some(window) = on_title.get_window(LABEL) {
                let _ = window.set_title(window_title(&title));
                // A new title lays the title bar out anew, the buttons back at its top.
                keep_lights(&on_title);
            }
        })
        // The site knows it is in the app and on which system (its own title bar, sign-in through the
        // browser, the device's name in its words), that `this_mac` takes `servers` and `files` (older apps
        // refuse them, so the sign-in's other server and Storage's "Show the folder" show only where this says
        // so), that a connector's sign-in and the window's own browser sign-in come back here (`deep_link.rs`,
        // older apps don't take them), and that it lists the other servers' workspaces (`workspaces`,
        // ADR 0154); nothing else.
        .initialization_script(format!(
            "window.__agentesDesktop = Object.freeze({{ version: {version:?}, platform: {PLATFORM:?}, servers: true, files: true, connectorReturn: true, workspaces: true }});"
        ))
        .on_navigation(move |url| match route_now(&on_nav, url) {
            Route::Stay => true,
            Route::Front => {
                let app = on_nav.clone();
                // Not from inside the navigation callback: the window's own thread is busy with it.
                std::thread::spawn(move || {
                    let _ = front(&app);
                });
                true
            }
            Route::Outside => {
                open_outside(&on_nav, url);
                false
            }
            Route::Drop => false,
        })
        // `target="_blank"`, ⌘-click and window.open: a page of the server moves the window there; anything
        // else opens in the browser. Never a second app window.
        .on_new_window(move |url, _| {
            if route_now(&on_new, &url) == Route::Stay && matches!(url.scheme(), "http" | "https") {
                let app = on_new.clone();
                std::thread::spawn(move || {
                    let _ = open(&app, Some(url));
                });
            } else {
                open_outside(&on_new, &url);
            }
            NewWindowResponse::Deny
        })
        // A whole page loading again (⌘R, macOS ended it, a full navigation): the cover, never a blank window.
        .on_page_load(move |_, payload| match payload.event() {
            PageLoadEvent::Started => crate::cover::show(&on_load, Duration::ZERO),
            // The page's own sizes follow the zoom (desktop.css), and the bar knows about full screen.
            PageLoadEvent::Finished => fit_page(&on_load),
        })
        .on_download(move |_, event| match event {
            DownloadEvent::Requested { destination, .. } => match downloads_path(&on_download, destination) {
                Some(path) => {
                    *destination = path;
                    true
                }
                None => false,
            },
            DownloadEvent::Finished { path, success, .. } => {
                if success {
                    if let Some(p) = path.as_ref() {
                        quarantine(p);
                    }
                    if let Some(name) = path.as_ref().and_then(|p| p.file_name()) {
                        crate::menus::downloaded(&on_download, &name.to_string_lossy());
                    }
                }
                true
            }
            _ => true,
        });
    let builder = match (saved.x, saved.y) {
        (Some(x), Some(y)) => builder.position(x, y),
        _ => builder.center(),
    };
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        // The buttons are placed by `place_lights` (on every fit), not with `traffic_light_position`.
        .hidden_title(true);
    let built = builder.build().map_err(|e| e.to_string())?;
    let window = built.as_ref().window();
    if saved.maximized {
        let _ = window.maximize();
    }
    if let Some(step) = saved.zoom {
        let _ = built.set_zoom(crate::menus::restore_zoom(app, step));
    }
    crate::cover::attach(app, &window).map_err(|e| e.to_string())?;
    crate::cover::opening(app);
    #[cfg(target_os = "macos")]
    follow_lights(app);
    fit_page(app);
    front(app)
}

/// The window's name for the page's title: the site's own long title (sign-in, the landing) is just the app's.
fn window_title(title: &str) -> &str {
    let title = title.trim();
    if title.is_empty() || title.starts_with("agentes.chat ·") {
        "agentes.chat"
    } else {
        title
    }
}

/// Tells the page the zoom (`--app-zoom`: its title bar stays 48pt and level with the window's buttons) and
/// whether the window is full screen (no room kept for the buttons then), and puts the buttons back in the
/// bar's middle (a resize or full screen lays them out anew). AppKit is touched on the main thread.
pub fn fit_page(app: &AppHandle) {
    keep_lights(app);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let window = handle.get_window(LABEL);
        let full = window.as_ref().is_some_and(in_full_screen);
        let Some(page) = handle.get_webview(LABEL) else { return };
        let zoom = crate::menus::current_zoom(&handle);
        let _ = page.eval(format!(
            "document.documentElement.style.setProperty('--app-zoom','{zoom}');\
             document.documentElement.toggleAttribute('data-fullscreen',{full});"
        ));
    });
}

/// Whether the window is in full screen, asked of AppKit. tao's `is_fullscreen` takes the lock it holds through a
/// whole zoom (a double click on the title bar): called from anything a zoom's animation sets off on the main thread,
/// a frame notice or a resize, the main thread would wait for itself and the window would stop for good.
pub fn in_full_screen(window: &tauri::Window) -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};
        /// NSWindowStyleMaskFullScreen.
        const FULL_SCREEN: usize = 1 << 14;
        let Ok(ns) = window.ns_window() else { return false };
        let ns = ns as *mut AnyObject;
        if ns.is_null() {
            return false;
        }
        // SAFETY: `ns` is this window's live NSWindow; `styleMask` only reads it.
        let mask: usize = unsafe { msg_send![ns, styleMask] };
        mask & FULL_SCREEN != 0
    }
    #[cfg(not(target_os = "macos"))]
    window.is_fullscreen().unwrap_or(false)
}

/// The window's buttons back in the middle of the site's title bar after AppKit lays it out anew (a resize,
/// a new title, focus, the cover going): now, on the next turn of the main loop, and once more a moment later
/// (a new title's layout pass can come after both). Nothing in full screen (no buttons).
pub fn keep_lights(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            place_now(&handle);
            let again = handle.clone();
            let _ = handle.run_on_main_thread(move || place_now(&again));
        });
        let later = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(LIGHTS_AGAIN);
            let handle = later.clone();
            let _ = later.run_on_main_thread(move || place_now(&handle));
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// How long after a layout the buttons are placed once more.
#[cfg(target_os = "macos")]
const LIGHTS_AGAIN: Duration = Duration::from_millis(300);

#[cfg(target_os = "macos")]
fn place_now(app: &AppHandle) {
    // A move made while placing (AppKit moves the next button from inside our own notice) is answered by
    // placing once more, not dropped. A few rounds at most.
    if PLACING.with(|p| p.replace(true)) {
        AGAIN.with(|a| a.set(true));
        return;
    }
    for _ in 0..3 {
        AGAIN.with(|a| a.set(false));
        if let Some(window) = app.get_window(LABEL) {
            if in_full_screen(&window) {
                LIGHTS_AT.with(|a| a.borrow_mut().clear());
            } else {
                place_lights(&window);
            }
        }
        if !AGAIN.with(|a| a.get()) {
            break;
        }
    }
    PLACING.with(|p| p.set(false));
}

/// Keeps the buttons where `place_lights` puts them. A new title (every chat switched to) lays the title bar
/// out on the next display pass, after `keep_lights` has already placed them, and they showed at the bar's top
/// until the later pass (a visible jump). So: their frames are watched and placed again inside that same
/// layout pass, and each button re-applies its place after its own layout (`follow_layout`), which puts its
/// layer back where AppKit draws it natively without touching its frame. The gap between them is read here,
/// once, from AppKit's own layout: read later it is whatever the last placement left.
#[cfg(target_os = "macos")]
fn follow_lights(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_window(LABEL) {
            watch_lights(&handle, &window);
        }
    });
}

#[cfg(target_os = "macos")]
fn watch_lights(app: &AppHandle, window: &tauri::Window) {
    use crate::notch::native::CGRect;
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use std::ptr::NonNull;

    let Ok(ns) = window.ns_window() else { return };
    let ns = ns as *mut AnyObject;
    if ns.is_null() {
        return;
    }
    // SAFETY: `ns` is this window's live NSWindow, on the main thread; the views watched are its own buttons,
    // their row and its container, which live as long as the window.
    unsafe {
        let buttons: [*mut AnyObject; 3] = [
            msg_send![ns, standardWindowButton: 0usize],
            msg_send![ns, standardWindowButton: 1usize],
            msg_send![ns, standardWindowButton: 2usize],
        ];
        if buttons.iter().any(|b| b.is_null()) {
            return;
        }
        let first: CGRect = msg_send![buttons[0], frame];
        let second: CGRect = msg_send![buttons[1], frame];
        let step = second.origin.x - first.origin.x;
        if step > first.size.width {
            LIGHTS_STEP.with(|s| s.set(Some(step)));
        }
        for button in buttons {
            follow_layout(button);
        }
        let row: *mut AnyObject = msg_send![buttons[0], superview];
        let container: *mut AnyObject = if row.is_null() { row } else { msg_send![row, superview] };
        let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
        let name: *mut AnyObject =
            msg_send![class!(NSString), stringWithUTF8String: c"NSViewFrameDidChangeNotification".as_ptr()];
        let handle = app.clone();
        let block = RcBlock::new(move |_: NonNull<AnyObject>| place_now(&handle));
        for view in buttons.into_iter().chain([row, container]).filter(|v| !v.is_null()) {
            let _: () = msg_send![view, setPostsFrameChangedNotifications: true];
            let nil: *mut AnyObject = std::ptr::null_mut();
            let _: *mut AnyObject =
                msg_send![center, addObserverForName: name, object: view, queue: nil, usingBlock: &*block];
        }
    }
}

/// Gives a window button a subclass of its own class that keeps it where it was placed. On a new title AppKit
/// moves each button back to its own spot (`-[NSThemeFrame _updateButtonPositions]` calls
/// `setFrameOrigin:ignoreRentry:`), the last one from inside our own frame notice, so it stayed there until the
/// later placement: the subclass answers that call with the placed spot instead (outside full screen, where the
/// buttons are AppKit's). Its `layout` also places it again afterwards (the layer laid out natively with the
/// frame unchanged).
///
/// SAFETY: `button` is a live window button, on the main thread. The subclass adds no ivars and overrides
/// `layout` and `setFrameOrigin:ignoreRentry:` (only if its class has it), calling its superclass's.
#[cfg(target_os = "macos")]
unsafe fn follow_layout(button: *mut objc2::runtime::AnyObject) {
    use crate::notch::native::CGPoint;
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{msg_send, sel};
    use std::ffi::CString;

    unsafe extern "C-unwind" fn layout(this: *mut AnyObject, _: Sel) {
        let Some(this) = (unsafe { this.as_ref() }) else { return };
        let Some(superclass) = this.class().superclass() else { return };
        let _: () = unsafe { msg_send![super(this, superclass), layout] };
        if let Some(origin) = placed_at(this) {
            let _: () = unsafe { msg_send![this, setFrameOrigin: origin] };
        }
    }

    unsafe extern "C-unwind" fn set_origin(this: *mut AnyObject, _: Sel, origin: CGPoint, ignore: Bool) {
        let Some(this) = (unsafe { this.as_ref() }) else { return };
        let Some(superclass) = this.class().superclass() else { return };
        let origin = placed_at(this).filter(|_| !unsafe { full_screen(this) }).unwrap_or(origin);
        let _: () = unsafe { msg_send![super(this, superclass), setFrameOrigin: origin, ignoreRentry: ignore] };
    }

    let class = unsafe { &*button }.class();
    let class_name = class.name().to_string_lossy();
    if class_name.starts_with(FOLLOWING) {
        return;
    }
    let Ok(name) = CString::new(format!("{FOLLOWING}{class_name}")) else { return };
    let sub = match AnyClass::get(&name) {
        Some(sub) => sub,
        None => {
            let Some(mut builder) = ClassBuilder::new(&name, class) else { return };
            unsafe {
                builder.add_method(sel!(layout), layout as unsafe extern "C-unwind" fn(*mut AnyObject, Sel));
                let moved = sel!(setFrameOrigin:ignoreRentry:);
                if class.instance_method(moved).is_some() {
                    builder.add_method(
                        moved,
                        set_origin as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, CGPoint, Bool),
                    );
                }
            }
            builder.register()
        }
    };
    unsafe { AnyObject::set_class(&*button, sub) };
}

/// Where `place_lights` last put this button, if anywhere.
#[cfg(target_os = "macos")]
fn placed_at(button: &objc2::runtime::AnyObject) -> Option<crate::notch::native::CGPoint> {
    let key = button as *const objc2::runtime::AnyObject as usize;
    LIGHTS_AT.with(|at| at.borrow().iter().find(|(b, _)| *b == key).map(|(_, o)| *o))
}

/// Whether the button's window is full screen (NSWindowStyleMaskFullScreen), or it has none.
///
/// SAFETY: `button` is a live view, on the main thread.
#[cfg(target_os = "macos")]
unsafe fn full_screen(button: &objc2::runtime::AnyObject) -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let window: *mut AnyObject = unsafe { msg_send![button, window] };
    if window.is_null() {
        return true;
    }
    let mask: usize = unsafe { msg_send![window, styleMask] };
    mask & (1 << 14) != 0
}

/// The prefix of the buttons' own subclasses (`follow_layout`).
#[cfg(target_os = "macos")]
const FOLLOWING: &str = "AgentesFollowing";

#[cfg(target_os = "macos")]
thread_local! {
    /// Placing the buttons moves them too: their own frame notices don't start another placement.
    static PLACING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// A button moved while placing: placed once more.
    static AGAIN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// From one button's left edge to the next's, as AppKit lays them out.
    static LIGHTS_STEP: std::cell::Cell<Option<f64>> = const { std::cell::Cell::new(None) };
    /// Where each button was placed last (by its address), for `follow_layout`.
    static LIGHTS_AT: std::cell::RefCell<Vec<(usize, crate::notch::native::CGPoint)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// The site's title bar (apps/web desktop.css), in points.
#[cfg(target_os = "macos")]
const TITLE_BAR: f64 = 48.0;
/// The close button's left edge, in points.
#[cfg(target_os = "macos")]
const LIGHTS_LEFT: f64 = 16.0;

/// The window's close, minimize and zoom buttons in the middle of the site's title bar, as Electron places
/// them (`WindowButtonsProxy`): the title bar's container as tall as the bar, each button centred in it.
/// `traffic_light_position` only makes the container taller, and macOS 26 keeps the buttons at its top (their
/// middle at ~15pt on macOS 27, under the bar's icons at 24pt).
#[cfg(target_os = "macos")]
fn place_lights(window: &tauri::Window) {
    use crate::notch::native::{CGPoint, CGRect};
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let Ok(ns) = window.ns_window() else { return };
    let ns = ns as *mut AnyObject;
    if ns.is_null() {
        return;
    }
    // SAFETY: `ns` is this window's live NSWindow, on the main thread; the buttons and their container are
    // its own views (NSWindowCloseButton, MiniaturizeButton, ZoomButton = 0, 1, 2).
    unsafe {
        let buttons: [*mut AnyObject; 3] = [
            msg_send![ns, standardWindowButton: 0usize],
            msg_send![ns, standardWindowButton: 1usize],
            msg_send![ns, standardWindowButton: 2usize],
        ];
        if buttons.iter().any(|b| b.is_null()) {
            return;
        }
        let row: *mut AnyObject = msg_send![buttons[0], superview];
        if row.is_null() {
            return;
        }
        let container: *mut AnyObject = msg_send![row, superview];
        if container.is_null() {
            return;
        }
        let window_frame: CGRect = msg_send![ns, frame];
        let first: CGRect = msg_send![buttons[0], frame];
        let step = LIGHTS_STEP.with(|s| s.get()).unwrap_or_else(|| {
            let second: CGRect = msg_send![buttons[1], frame];
            second.origin.x - first.origin.x
        });
        let mut bar: CGRect = msg_send![container, frame];
        bar.size.height = TITLE_BAR;
        bar.origin.y = window_frame.size.height - TITLE_BAR;
        let _: () = msg_send![container, setFrame: bar];
        let mut at = Vec::with_capacity(3);
        for (i, button) in buttons.into_iter().enumerate() {
            let frame: CGRect = msg_send![button, frame];
            let origin = CGPoint {
                x: LIGHTS_LEFT + i as f64 * step,
                y: (TITLE_BAR - frame.size.height) / 2.0,
            };
            at.push((button as usize, origin));
            let _: () = msg_send![button, setFrameOrigin: origin];
        }
        LIGHTS_AT.with(|a| *a.borrow_mut() = at);
    }
}

/// Downloads land in ~/Downloads under their own name, never over an existing file.
fn downloads_path(app: &AppHandle, suggested: &Path) -> Option<PathBuf> {
    let dir = app.path().download_dir().ok()?;
    let name = suggested.file_name()?.to_string_lossy().into_owned();
    let path = dir.join(&name);
    if !path.exists() {
        return Some(path);
    }
    let stem = Path::new(&name).file_stem()?.to_string_lossy().into_owned();
    let ext = Path::new(&name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (1..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists())
}

/// A file downloaded from the site gets the quarantine mark, as from a browser, so the Mac checks it before
/// it opens. Only here: the app-wide switch (LSFileQuarantineEnabled) also marked what the agents' commands
/// make, and Gatekeeper then stopped every binary they built (Info.plist).
#[cfg(target_os = "macos")]
fn quarantine(path: &Path) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = std::process::Command::new("/usr/bin/xattr")
        .args(["-w", "com.apple.quarantine", &format!("0081;{now:x};agentes.chat;")])
        .arg(path)
        .status();
}

#[cfg(not(target_os = "macos"))]
fn quarantine(_path: &Path) {}

fn front(app: &AppHandle) -> Result<(), String> {
    let window = app.get_window(LABEL).ok_or("window not found")?;
    let _ = window.unminimize();
    window.show().map_err(|e| e.to_string())?;
    crate::sync_dock(app);
    window.set_focus().map_err(|e| e.to_string())
}

/// What the site may ask of this computer: which of its organizations this computer works for (`status`),
/// pairing it with one (`connect`: the system's own dialog asks first, then the site confirms the runner's
/// code with its own session), reconnecting it (`reconnect`), Preferences on a tab (`prefs`), the menu bar's
/// access requests (`requests`), the Dock's badge (`badge`), the Go menu's organizations (`orgs`), a
/// notification while the app is in the background (`notify`), the first run's window to pick another server
/// (`servers`: the sign-in page's way out, the same window as Servers › Add a server…) and, on the server
/// here, signing its owner in (`signIn`: the app spends its owner key on a one-time sign-in, which the window
/// trades itself) and the folder of its files (`files`: Storage's "Show the folder"). Rust checks
/// each request, rebuilds it from the keys it may have, adds the asking page's own `origin`, whether agents may
/// work here for it and whether it is the server here (`local`), and relays it: the popover's code owns the
/// runners (apps/desktop/src/control/this-mac.ts) and answers through `this_mac_reply`. The machine's token
/// and the owner key never leave the app.
#[derive(Default)]
pub struct Bridge {
    next: AtomicU64,
    waiting: Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    /// The popover listens (`this_mac_listening`): before that a request would be lost, so it waits.
    listening: AtomicBool,
    /// The last owner sign-in, at most one every 10 seconds.
    signed_in: Mutex<Option<Instant>>,
}

const SIGN_IN_GAP: Duration = Duration::from_secs(10);

/// How long the popover has to answer (`connect` waits for the runner's code).
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(30);
/// How long a request waits for the popover to start listening (the app just opened).
const LISTEN_TIMEOUT: Duration = Duration::from_secs(10);
/// Requests waiting at once; more are refused (each holds a thread while it waits).
const MAX_WAITING: usize = 16;
/// Organizations in the Go menu (⌘⌥1–9 for the first nine).
const MAX_ORGS: usize = 20;
const PREF_TABS: &[&str] = &["folders", "tools", "updates"];
/// A notification's size, as a phone push's (apps/server push-messages.ts).
const NOTIFY_TITLE_MAX: usize = 80;
const NOTIFY_BODY_MAX: usize = 180;

/// A short display name the page sends (an organization's): trimmed, at most 80 characters.
fn display_name(value: Option<&Value>) -> Option<String> {
    let name: String = value?.as_str()?.trim().chars().take(80).collect();
    (!name.is_empty() && !name.chars().any(char::is_control)).then_some(name)
}

/// The request rebuilt from the keys it may have; anything else is refused.
fn checked(request: &Value) -> Result<Value, String> {
    let text = |key: &str| request.get(key).and_then(Value::as_str);
    let org = || {
        let org = text("orgId").unwrap_or_default();
        let ok = !org.is_empty()
            && org.len() <= 64
            && org.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if ok {
            Ok(org)
        } else {
            Err("bad organization id".to_string())
        }
    };
    match text("kind") {
        Some("status") => Ok(json!({ "kind": "status" })),
        Some("requests") => Ok(json!({ "kind": "requests" })),
        Some("signIn") => Ok(json!({ "kind": "signIn" })),
        Some("servers") => Ok(json!({ "kind": "servers" })),
        // Every server's workspaces (ADR 0154): the app reads them; the page asks nothing of its own.
        Some("workspaces") => Ok(json!({ "kind": "workspaces" })),
        Some("addWorkspace") => Ok(json!({ "kind": "addWorkspace" })),
        // A server of the app's list: only its origin.
        Some("openServer") => {
            let server = text("server").unwrap_or_default();
            if servers::origin_of(server).as_deref() != Some(server) {
                return Err("bad server".into());
            }
            Ok(json!({ "kind": "openServer", "server": server }))
        }
        // A workspace of another server of the app's list: only its origin and the workspace's id.
        Some("openWorkspace") => {
            let server = text("server").unwrap_or_default();
            if servers::origin_of(server).as_deref() != Some(server) {
                return Err("bad server".into());
            }
            Ok(json!({ "kind": "openWorkspace", "server": server, "orgId": org()? }))
        }
        // The folder is the app's to know: the page names none.
        Some("files") => Ok(json!({ "kind": "files" })),
        Some("connect") => {
            let mut out = json!({ "kind": "connect", "orgId": org()? });
            if let Some(name) = display_name(request.get("orgName")) {
                out["orgName"] = json!(name);
            }
            Ok(out)
        }
        Some("reconnect") => Ok(json!({ "kind": "reconnect", "orgId": org()? })),
        Some("prefs") => match text("tab") {
            Some(tab) if PREF_TABS.contains(&tab) => Ok(json!({ "kind": "prefs", "tab": tab })),
            _ => Err("unknown tab".into()),
        },
        // The Dock's badge: two counts, nothing else.
        Some("badge") => {
            let count = |key: &str| request.get(key).and_then(Value::as_u64).unwrap_or(0).min(100_000);
            Ok(json!({ "kind": "badge", "waiting": count("waiting"), "unread": count("unread") }))
        }
        // The Go menu's organizations: ids like `orgId`, short names.
        Some("orgs") => {
            let list = request.get("orgs").and_then(Value::as_array).ok_or("bad organizations")?;
            let orgs = list
                .iter()
                .take(MAX_ORGS)
                .map(|o| {
                    let id = o.get("id").and_then(Value::as_str).unwrap_or_default();
                    let ok = !id.is_empty()
                        && id.len() <= 64
                        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
                    match display_name(o.get("name")) {
                        Some(name) if ok => Ok(json!({ "id": id, "name": name })),
                        _ => Err("bad organization".to_string()),
                    }
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(json!({ "kind": "orgs", "orgs": orgs }))
        }
        // A notification: short text, and a path of the same server to open when the app comes back.
        Some("notify") => {
            let title = text("title").map(str::trim).unwrap_or_default();
            let body = text("body").map(str::trim).unwrap_or_default();
            let path = text("path").unwrap_or("/");
            let fits = !title.is_empty()
                && title.chars().count() <= NOTIFY_TITLE_MAX
                && body.chars().count() <= NOTIFY_BODY_MAX
                && !format!("{title}{body}").chars().any(|c| c.is_control() && c != '\n');
            let local = path.starts_with('/') && !path.starts_with("//") && !path.contains('\\') && path.len() <= 512;
            if !fits || !local {
                return Err("bad notification".into());
            }
            let mut out = json!({ "kind": "notify", "title": title, "body": body, "path": path });
            // Someone's agent uses a phone here: the web's Stop, as the notification's button.
            if let Some(phone) = text("phoneId") {
                if !crate::workspaces::good_id(phone) {
                    return Err("bad notification".into());
                }
                out["stop"] = json!({ "orgId": org()?, "phoneId": phone });
            }
            Ok(out)
        }
        _ => Err("unknown request".into()),
    }
}

/// `files` reaches the popover only from the server here's own page, marked `local`: the folder it shows is this
/// computer's.
fn files_gate(mut request: Value, server_here: bool) -> Result<Value, String> {
    if request["kind"] == "files" {
        if !server_here {
            return Err("not_here".into());
        }
        request["local"] = json!(true);
    }
    Ok(request)
}

/// The site's notifications: at most one every 3 seconds and 60 an hour, only while the window isn't in
/// front, and only while the person wants them (Preferences › General). Coming back to the app within 30
/// seconds opens the last one's page.
pub struct Notices(Mutex<NoticeState>);

struct NoticeState {
    on: bool,
    sent: VecDeque<Instant>,
    pending: Option<(Url, Instant)>,
}

impl Default for Notices {
    fn default() -> Self {
        Self(Mutex::new(NoticeState { on: true, sent: VecDeque::new(), pending: None }))
    }
}

const NOTIFY_GAP: Duration = Duration::from_secs(3);
const NOTIFY_PER_HOUR: usize = 60;
const NOTIFY_OPENS_FOR: Duration = Duration::from_secs(30);

/// Whether one more notification fits the limits at `now` (and counts it).
fn notice_fits(sent: &mut VecDeque<Instant>, now: Instant) -> bool {
    while sent.front().is_some_and(|t| now.duration_since(*t) > Duration::from_secs(3600)) {
        sent.pop_front();
    }
    if sent.back().is_some_and(|t| now.duration_since(*t) < NOTIFY_GAP) || sent.len() >= NOTIFY_PER_HOUR {
        return false;
    }
    sent.push_back(now);
    true
}

fn notify(app: &AppHandle, request: &Value, site: &Url) {
    let Ok(url) = site.join(request["path"].as_str().unwrap_or("/")) else { return };
    let stop = request.get("stop").map(|stop| {
        json!({ "server": site.origin().ascii_serialization(), "orgId": stop["orgId"], "phoneId": stop["phoneId"] })
    });
    let (title, body) = (request["title"].as_str().unwrap_or_default(), request["body"].as_str().unwrap_or_default());
    show_notice(app, title, body, url, stop);
}

/// A notification with the site's limits: `url` (a page of a server of the app's list, the one open or another,
/// ADR 0154) opens when the app comes back within 30 seconds.
pub fn notice(app: &AppHandle, title: &str, body: &str, url: Url) {
    show_notice(app, title, body, url, None);
}

/// The notifications' Stop button (`stop_from_notices`).
const STOP_ACTIONS: &str = "device-stop";

/// `stop`: the server, workspace and phone a Stop button takes back, labelled in the app's language (none before
/// the labels arrived).
fn show_notice(app: &AppHandle, title: &str, body: &str, url: Url, stop: Option<Value>) {
    let in_front = app.get_window(LABEL).and_then(|w| w.is_focused().ok()).unwrap_or(false);
    {
        let notices = app.state::<Notices>();
        let mut state = notices.0.lock().unwrap_or_else(|e| e.into_inner());
        if in_front || !state.on || !notice_fits(&mut state.sent, Instant::now()) {
            return;
        }
        state.pending = Some((url.clone(), Instant::now()));
    }
    let mut builder = app.notification().builder().title(title).body(body).extra("url", url.as_str());
    if let (Some(stop), Some(label)) = (stop, crate::menus::labels(app).get("notifyStop").cloned()) {
        let stop_type = ActionType::builder(STOP_ACTIONS).actions(vec![Action::builder("stop", label).build()]).build();
        let _ = app.notification().register_action_types(vec![stop_type]);
        builder = builder.action_type_id(STOP_ACTIONS).extra("stop", stop);
    }
    let _ = builder.show();
}

/// A notification's click and its Stop. With a handler registered the plugin reports every click here, and the app
/// may not come forward by itself (`focused` would not see it): the click opens its own page. Stop: the stop the
/// web's button makes, with the window's session for that server. When it can't (signed out, offline, no longer
/// allowed), the phone's page opens, where Stop is.
pub fn stop_from_notices(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.notification().on_action(move |performed| {
        let action = performed.action_id();
        if action != "tap" && action != "stop" {
            return;
        }
        let extra = |key: &str| performed.notification().and_then(|n| n.extra().get(key)).cloned();
        let app = handle.clone();
        // Handled here: the app coming forward from this click opens nothing more.
        app.state::<Notices>().0.lock().unwrap_or_else(|e| e.into_inner()).pending = None;
        if action == "tap" {
            let Some(url) = extra("url").and_then(|u| u.as_str().and_then(|u| u.parse::<Url>().ok())) else { return };
            std::thread::spawn(move || {
                let _ = show_url(&app, url);
            });
            return;
        }
        let Some(stop) = extra("stop") else { return };
        std::thread::spawn(move || {
            let text = |key: &str| stop[key].as_str().unwrap_or_default().to_string();
            let (server, org, phone) = (text("server"), text("orgId"), text("phoneId"));
            let path = format!("/api/app/organizations/{org}/devices/phones/{phone}/stop");
            let stopped = crate::workspaces::with_session(&app, &server, "POST", &path, Some("{}"))
                .is_ok_and(|answer| (200..300).contains(&answer.status));
            if !stopped {
                if let Ok(url) = format!("{server}/org/{org}/settings/devices/phones/{phone}").parse::<Url>() {
                    let _ = show_url(&app, url);
                }
            }
        });
    });
}

/// The main window came to the front: within 30 seconds of a notification, its page (on its server, which
/// becomes the one open); and the other servers' workspaces are read again.
pub fn focused(app: &AppHandle) {
    keep_lights(app);
    crate::workspaces::on_focus(app);
    // Brought forward by a notification of the server here: the popover says what happened and how to fix it.
    if crate::local_server::take_notice_click() {
        let _ = crate::present(app, "popover");
        return;
    }
    let pending = {
        let notices = app.state::<Notices>();
        let mut state = notices.0.lock().unwrap_or_else(|e| e.into_inner());
        state.pending.take()
    };
    if let Some((url, at)) = pending {
        if at.elapsed() <= NOTIFY_OPENS_FOR {
            let app = app.clone();
            // Another server's page loads the window anew: not from inside the focus event.
            std::thread::spawn(move || {
                let _ = show_url(&app, url);
            });
        }
    }
}

/// Preferences › General › "Let me know about messages and requests" (the popover sends it at start).
#[tauri::command]
pub fn notify_site_set(app: AppHandle, window: tauri::Window, on: bool) -> Result<(), String> {
    if !matches!(window.label(), "popover" | "prefs") {
        return Err("only the app's own windows set this".into());
    }
    app.state::<Notices>().0.lock().unwrap_or_else(|e| e.into_inner()).on = on;
    Ok(())
}

/// The page's own server, when it is one of the app's (the window shows only those).
fn page_origin(app: &AppHandle, webview: &tauri::Webview) -> Option<String> {
    let origin = webview.url().ok()?.origin().ascii_serialization();
    servers::get(app).servers.contains(&origin).then_some(origin)
}

/// The system's own dialog before a page pairs this computer: the server's host from the app, the
/// organization's name from the page (display only). False when declined, or before the labels arrived.
fn ask_to_pair(app: &AppHandle, org: &str, host: &str) -> bool {
    let labels = crate::menus::labels(app);
    let (Some(title), Some(body), Some(allow), Some(not_now)) =
        (labels.get("pairTitle"), labels.get("pairBody"), labels.get("pairAllow"), labels.get("pairNotNow"))
    else {
        return false;
    };
    app.dialog()
        .message(body.replace("{host}", host))
        .title(title.replace("{org}", org))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(allow.clone(), not_now.clone()))
        .blocking_show()
}

/// Preferences › This Mac's switch for a workspace this computer doesn't work for yet: the same system dialog as the
/// site's "This Mac", for a server of the app's list. False when declined.
#[tauri::command]
pub async fn pair_ask(app: AppHandle, window: tauri::Window, server: String, org: String) -> Result<bool, String> {
    if window.label() != "prefs" {
        return Err("only Preferences asks this".into());
    }
    if !servers::get(&app).servers.contains(&server) {
        return Err("not a server of this app".into());
    }
    let org = display_name(Some(&json!(org))).ok_or("bad organization name")?;
    let host = server.parse::<Url>().ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || ask_to_pair(&app, &org, &host)).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn this_mac(app: AppHandle, webview: tauri::Webview, request: Value) -> Result<Value, String> {
    // The site itself, not the cover that shares its window.
    if webview.label() != LABEL {
        return Err("only the main window asks this".into());
    }
    let mut request = checked(&request)?;
    let origin = page_origin(&app, &webview).ok_or("not a server of this app")?;
    let server_here = crate::local_server::is_here(&app, &origin);
    // The server here's pages count only while its own child answers there: another program can listen on
    // its port while it is down. A page that loaded as it came up waits for that a moment.
    if server_here {
        let (waiter, asking) = (app.clone(), origin.clone());
        let up = tauri::async_runtime::spawn_blocking(move || {
            crate::local_server::answers_within(&waiter, &asking, Duration::from_secs(10))
        })
        .await
        .unwrap_or(false);
        if !up {
            return Err("not_ready".into());
        }
    }
    // What the app itself answers (the popover isn't needed).
    match request["kind"].as_str() {
        Some("badge") => {
            let count = |key: &str| u32::try_from(request[key].as_u64().unwrap_or(0)).unwrap_or(u32::MAX);
            crate::dock::set_badge(&app, count("waiting"), count("unread"));
            return Ok(json!({}));
        }
        Some("orgs") => {
            // A new organization on the server here: this computer works for it within seconds. Signed in or a new
            // workspace anywhere: the workspaces are read again, so the app offers this computer to it at once.
            if crate::menus::set_orgs(&app, &request["orgs"]) {
                if server_here {
                    crate::host_sync::trigger(&app);
                }
                crate::workspaces::trigger(&app);
            }
            return Ok(json!({}));
        }
        Some("signIn") => {
            if !server_here {
                return Err("not_here".into());
            }
            {
                let bridge = app.state::<Bridge>();
                let mut last = bridge.signed_in.lock().unwrap_or_else(|e| e.into_inner());
                if last.is_some_and(|at| at.elapsed() < SIGN_IN_GAP) {
                    return Err("too_soon".into());
                }
                *last = Some(Instant::now());
            }
            let signer = app.clone();
            return tauri::async_runtime::spawn_blocking(move || crate::local_server::sign_in_window(&signer, &origin))
                .await
                .map_err(|e| e.to_string())?
                .map(|()| json!({}));
        }
        Some("notify") => {
            if let Ok(site) = origin.parse::<Url>() {
                notify(&app, &request, &site);
            }
            return Ok(json!({}));
        }
        // Only a window of the app's own: the person picks and confirms the server there.
        Some("servers") => {
            crate::present(&app, "welcome")?;
            return Ok(json!({}));
        }
        // The other servers' workspaces, as last read (the page's own server lists its own).
        Some("workspaces") => {
            // Never read yet (the app's first check ran before this window existed): read now and answer with it,
            // so the site's menu never starts empty for a minute.
            if crate::workspaces::never_read(&app) {
                let reader = app.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || crate::workspaces::refresh_now(&reader)).await;
            } else if crate::workspaces::stale(&app) {
                crate::workspaces::trigger(&app);
            }
            let others: Vec<_> = crate::workspaces::list(&app).into_iter().filter(|s| s.server != origin).collect();
            return Ok(json!({ "servers": others }));
        }
        // "Add a workspace": the welcome window, in that mode.
        Some("addWorkspace") => {
            *app.state::<crate::workspaces::WelcomeMode>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some("add");
            crate::present(&app, "welcome")?;
            return Ok(json!({}));
        }
        // A workspace on another server of the list: the window goes there (already signed in, its cookies).
        Some("openWorkspace") => {
            let server = request["server"].as_str().unwrap_or_default();
            if !servers::get(&app).servers.iter().any(|s| s == server) {
                return Err("not a server of this app".into());
            }
            let url: Url = format!("{server}/org/{}", request["orgId"].as_str().unwrap_or_default())
                .parse()
                .map_err(|_| "not a URL")?;
            show_url(&app, url)?;
            return Ok(json!({}));
        }
        // Another server of the list on its first page: its sign-in when the window has no session there.
        Some("openServer") => {
            let server = request["server"].as_str().unwrap_or_default();
            if !servers::get(&app).servers.iter().any(|s| s == server) {
                return Err("not a server of this app".into());
            }
            let url: Url = server.parse().map_err(|_| "not a URL")?;
            show_url(&app, url)?;
            return Ok(json!({}));
        }
        _ => {}
    }
    let asks_here = matches!(request["kind"].as_str(), Some("status" | "connect" | "reconnect"));
    let here = asks_here && agents_here(&origin, server_here) && {
        let (home, asking) = (app.path().home_dir().ok(), origin.clone());
        tauri::async_runtime::spawn_blocking(move || home.is_some_and(|h| !crate::discover::served_here(&h, &asking)))
            .await
            .unwrap_or(false)
    };
    if asks_here {
        request["origin"] = json!(origin);
        request["agentsHere"] = json!(here);
        // The server here's own homes point at its loopback address, whichever address the page has.
        if server_here {
            request["local"] = json!(true);
            if let Some(loopback) = crate::local_server::loopback(&app) {
                request["also"] = json!(loopback);
            }
        }
    }
    request = files_gate(request, server_here)?;
    if request["kind"] == "connect" {
        if !here {
            return Err("not_here".into());
        }
        let host = origin.parse::<Url>().ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
        let org = request["orgName"]
            .as_str()
            .map(str::to_string)
            .or_else(|| crate::menus::org_name(&app, request["orgId"].as_str().unwrap_or_default()))
            .unwrap_or_else(|| host.clone());
        let asker = app.clone();
        let allowed = tauri::async_runtime::spawn_blocking(move || ask_to_pair(&asker, &org, &host))
            .await
            .unwrap_or(false);
        if !allowed {
            return Err("declined".into());
        }
    }
    let id = app.state::<Bridge>().next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    {
        // The state outlives the lock (a temporary `State` would be dropped while still borrowed).
        let bridge = app.state::<Bridge>();
        let mut waiting = bridge.waiting.lock().map_err(|e| e.to_string())?;
        if waiting.len() >= MAX_WAITING {
            return Err("this computer is busy".into());
        }
        waiting.insert(id, tx);
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Right after the app opens, the popover may not listen yet: the request waits for it.
        let bridge = app.state::<Bridge>();
        let since = Instant::now();
        while !bridge.listening.load(Ordering::Relaxed) && since.elapsed() < LISTEN_TIMEOUT {
            std::thread::sleep(Duration::from_millis(50));
        }
        let sent = app.emit_to("popover", "this-mac://request", json!({ "id": id, "request": request }));
        let answer = match sent {
            Ok(()) => rx.recv_timeout(BRIDGE_TIMEOUT).unwrap_or_else(|_| Err("this computer didn't answer".into())),
            Err(e) => Err(e.to_string()),
        };
        let _ = bridge.waiting.lock().map(|mut w| w.remove(&id));
        answer
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The popover listens for `this_mac` requests now.
#[tauri::command]
pub fn this_mac_listening(app: AppHandle, window: tauri::Window) -> Result<(), String> {
    if window.label() != "popover" {
        return Err("only the popover listens".into());
    }
    app.state::<Bridge>().listening.store(true, Ordering::Relaxed);
    Ok(())
}

/// The popover's answer to a `this_mac` request.
#[tauri::command]
pub fn this_mac_reply(app: AppHandle, window: tauri::Window, id: u64, ok: bool, data: Value) -> Result<(), String> {
    if window.label() != "popover" {
        return Err("only the popover answers".into());
    }
    let waiting = app.state::<Bridge>().waiting.lock().map_err(|e| e.to_string())?.remove(&id);
    if let Some(tx) = waiting {
        let answer = if ok {
            Ok(data)
        } else {
            Err(data.as_str().unwrap_or("failed").to_string())
        };
        let _ = tx.send(answer);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(url: &str, site: &str) -> Route {
        route(&url.parse().unwrap(), &site.parse().unwrap())
    }

    #[test]
    fn in_page_moves_and_titles() {
        let go = |u: &str| go_in_page(&u.parse().unwrap());
        assert_eq!(go("https://app.agentes.chat/"), None);
        assert_eq!(
            go("https://app.agentes.chat/org/o1/c/c1?m=9#x").as_deref(),
            Some(r#"(window.__agentesNavigate || ((p) => location.assign(p)))("/org/o1/c/c1?m=9#x")"#)
        );
        assert_eq!(window_title("#loja · Acme"), "#loja · Acme");
        assert_eq!(window_title("agentes.chat · Your team and your agents"), "agentes.chat");
        assert_eq!(window_title("  "), "agentes.chat");
    }

    #[test]
    fn bridge_badge_and_orgs() {
        assert_eq!(
            checked(&json!({ "kind": "badge", "waiting": 3, "unread": 9, "x": 1 })),
            Ok(json!({ "kind": "badge", "waiting": 3, "unread": 9 }))
        );
        assert_eq!(
            checked(&json!({ "kind": "orgs", "orgs": [{ "id": "o-1", "name": " Acme " }] })),
            Ok(json!({ "kind": "orgs", "orgs": [{ "id": "o-1", "name": "Acme" }] }))
        );
        assert!(checked(&json!({ "kind": "orgs", "orgs": [{ "id": "../x", "name": "A" }] })).is_err());
        assert!(checked(&json!({ "kind": "orgs" })).is_err());
    }

    #[test]
    fn routes_follow_the_server_open_now() {
        for site in ["https://app.agentes.chat", "https://agentes.tail1234.ts.net", "http://127.0.0.1:4310"] {
            assert_eq!(r(&format!("{site}/org/x/c/y"), site), Route::Stay);
            assert_eq!(r(&format!("{site}/desktop/sign-in?provider=google&challenge=a"), site), Route::Outside);
            assert_eq!(r(&format!("{site}/desktop/signed-in?to=%2F"), site), Route::Front);
            assert_eq!(r(&format!("{site}/api/app/github-app/manifest/start?state=s"), site), Route::Outside);
            assert_eq!(r(&format!("blob:{site}/abc"), site), Route::Stay);
        }
        let own = "https://agentes.tail1234.ts.net";
        assert_eq!(r("https://app.agentes.chat/org/x", own), Route::Outside);
        assert_eq!(r("https://accounts.google.com/o/oauth2", own), Route::Outside);
        assert_eq!(r("http://agentes.tail1234.ts.net/", own), Route::Outside);
        assert_eq!(r("https://agentes.tail1234.ts.net.evil.com/", own), Route::Outside);
        assert_eq!(r("http://127.0.0.1:4311/", "http://127.0.0.1:4310"), Route::Outside);
        assert_eq!(r("mailto:a@b.c", own), Route::Outside);
        assert_eq!(r("agenteschat://desktop/sign-in?code=x", own), Route::Outside);
        for other in ["file:///etc/passwd", "smb://host/share", "tel:+5511", "vscode://file/x", "javascript:alert(1)"] {
            assert_eq!(r(other, own), Route::Drop, "{other}");
        }
        let cloud = "https://app.agentes.chat";
        assert_eq!(r("https://app.agentes.chat/help/memory?lang=en#learns", cloud), Route::Outside);
        assert_eq!(r("https://app.agentes.chat/org/x", cloud), Route::Stay);
    }

    #[test]
    fn the_bot_check_s_frame_stays_in_the_window_and_nothing_else_of_its_host() {
        for site in ["https://app.agentes.chat", "https://agentes.tail1234.ts.net", "http://127.0.0.1:4310"] {
            let frame = "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/x";
            assert_eq!(r(frame, site), Route::Stay);
            assert_eq!(r("https://challenges.cloudflare.com:443/turnstile/v0/api.js", site), Route::Stay);
            assert_eq!(r("http://challenges.cloudflare.com/turnstile/v0/api.js", site), Route::Outside);
            assert_eq!(r("https://challenges.cloudflare.com:8443/x", site), Route::Outside);
            assert_eq!(r("https://challenges.cloudflare.com.evil.example/x", site), Route::Outside);
            assert_eq!(r("https://evil.example/challenges.cloudflare.com", site), Route::Outside);
            assert_eq!(r("https://www.cloudflare.com/turnstile-privacy-policy/", site), Route::Outside);
        }
    }

    #[test]
    fn agents_work_here_only_for_a_server_elsewhere() {
        assert!(agents_here("https://app.agentes.chat", false), "agentes.chat too");
        assert!(!agents_here("http://127.0.0.1:4310", false));
        assert!(!agents_here("http://localhost:3000", false));
        assert!(agents_here("https://agentes.tail1234.ts.net", false));
        assert!(!agents_here("https://ana-mac.tail1234.ts.net", true), "the server here, at its Tailscale address");
    }

    #[test]
    fn bridge_requests() {
        assert_eq!(checked(&json!({ "kind": "status", "extra": 1 })), Ok(json!({ "kind": "status" })));
        assert_eq!(
            checked(&json!({ "kind": "connect", "orgId": "org_1-a", "origin": "https://evil.example" })),
            Ok(json!({ "kind": "connect", "orgId": "org_1-a" }))
        );
        assert_eq!(
            checked(&json!({ "kind": "connect", "orgId": "o1", "orgName": "  Acme  " })),
            Ok(json!({ "kind": "connect", "orgId": "o1", "orgName": "Acme" }))
        );
        assert_eq!(
            checked(&json!({ "kind": "connect", "orgId": "o1", "orgName": "a".repeat(200) }))
                .map(|v| v["orgName"].as_str().map(str::len)),
            Ok(Some(80))
        );
        assert!(checked(&json!({ "kind": "connect", "orgId": "../x" })).is_err());
        assert!(checked(&json!({ "kind": "connect" })).is_err());
        assert_eq!(checked(&json!({ "kind": "prefs", "tab": "folders" })), Ok(json!({ "kind": "prefs", "tab": "folders" })));
        assert!(checked(&json!({ "kind": "prefs", "tab": "advanced" })).is_err());
        assert_eq!(checked(&json!({ "kind": "reconnect", "orgId": "o1" })), Ok(json!({ "kind": "reconnect", "orgId": "o1" })));
        assert!(checked(&json!({ "kind": "reconnect" })).is_err());
        assert_eq!(checked(&json!({ "kind": "requests", "x": 1 })), Ok(json!({ "kind": "requests" })));
        assert_eq!(checked(&json!({ "kind": "signIn", "key": "x" })), Ok(json!({ "kind": "signIn" })));
        assert_eq!(
            checked(&json!({ "kind": "servers", "url": "https://evil.example" })),
            Ok(json!({ "kind": "servers" }))
        );
        // The page can't name a folder, or say it is the server here (Rust adds `local` itself).
        assert_eq!(
            checked(&json!({ "kind": "files", "path": "/etc", "local": true })),
            Ok(json!({ "kind": "files" }))
        );
        assert!(checked(&json!({ "kind": "runner_send" })).is_err());
    }

    #[test]
    fn workspaces_across_servers() {
        assert_eq!(checked(&json!({ "kind": "workspaces", "server": "x" })), Ok(json!({ "kind": "workspaces" })));
        assert_eq!(checked(&json!({ "kind": "addWorkspace", "page": "/x" })), Ok(json!({ "kind": "addWorkspace" })));
        assert_eq!(
            checked(&json!({ "kind": "openServer", "server": "https://agentes.exemplo.com.br", "path": "/x" })),
            Ok(json!({ "kind": "openServer", "server": "https://agentes.exemplo.com.br" }))
        );
        assert!(checked(&json!({ "kind": "openServer", "server": "https://agentes.exemplo.com.br/login" })).is_err());
        assert_eq!(
            checked(&json!({ "kind": "openWorkspace", "server": "https://agentes.exemplo.com.br", "orgId": "o-1", "path": "/x" })),
            Ok(json!({ "kind": "openWorkspace", "server": "https://agentes.exemplo.com.br", "orgId": "o-1" }))
        );
        for bad in [
            json!({ "kind": "openWorkspace", "server": "https://agentes.exemplo.com.br/org/x", "orgId": "o-1" }),
            json!({ "kind": "openWorkspace", "server": "http://evil.example", "orgId": "o-1" }),
            json!({ "kind": "openWorkspace", "server": "https://agentes.exemplo.com.br", "orgId": "../x" }),
            json!({ "kind": "openWorkspace", "orgId": "o-1" }),
        ] {
            assert!(checked(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn files_only_for_the_server_here() {
        let files = checked(&json!({ "kind": "files", "local": true })).unwrap();
        assert_eq!(files_gate(files.clone(), false), Err("not_here".to_string()));
        assert_eq!(files_gate(files, true), Ok(json!({ "kind": "files", "local": true })));
        assert_eq!(files_gate(json!({ "kind": "status" }), false), Ok(json!({ "kind": "status" })));
    }

    #[test]
    fn notifications_are_checked() {
        let ok = checked(&json!({ "kind": "notify", "title": "Ana mentioned you", "body": "in #general", "path": "/org/o1/c/c1" }));
        assert_eq!(
            ok,
            Ok(json!({ "kind": "notify", "title": "Ana mentioned you", "body": "in #general", "path": "/org/o1/c/c1" }))
        );
        let in_use = json!({ "kind": "notify", "title": "Lia is using Pixel 8", "body": "", "orgId": "o1", "phoneId": "p-1" });
        assert_eq!(checked(&in_use).map(|r| r["stop"].clone()), Ok(json!({ "orgId": "o1", "phoneId": "p-1" })));
        for bad in [
            json!({ "kind": "notify", "title": "", "body": "x" }),
            json!({ "kind": "notify", "title": "a".repeat(81), "body": "x" }),
            json!({ "kind": "notify", "title": "x", "body": "b".repeat(181) }),
            json!({ "kind": "notify", "title": "x", "body": "", "path": "//evil.example/x" }),
            json!({ "kind": "notify", "title": "x", "body": "", "path": "https://evil.example/x" }),
            json!({ "kind": "notify", "title": "x\u{7}", "body": "" }),
            json!({ "kind": "notify", "title": "x", "body": "", "phoneId": "p-1" }),
            json!({ "kind": "notify", "title": "x", "body": "", "orgId": "o1", "phoneId": "../p" }),
        ] {
            assert!(checked(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn notification_limits() {
        let mut sent = VecDeque::new();
        let start = Instant::now();
        assert!(notice_fits(&mut sent, start));
        assert!(!notice_fits(&mut sent, start + Duration::from_secs(1)));
        let mut at = start;
        for _ in 1..NOTIFY_PER_HOUR {
            at += Duration::from_secs(4);
            assert!(notice_fits(&mut sent, at));
        }
        assert!(!notice_fits(&mut sent, at + Duration::from_secs(10)), "60 an hour");
        assert!(notice_fits(&mut sent, start + Duration::from_secs(3601)), "an hour later the oldest is gone");
    }
}
