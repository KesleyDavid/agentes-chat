//! One runner child process per organization home (ADR 0036 §2, §4b), and none without homes: nothing of this
//! computer runs for a workspace until it is paired here, on agentes.chat Cloud as on a self-hosted server
//! (ADR 0165). The server here's own homes (`host_sync.rs`) run the same way.
//!
//! Each home lives in `~/.agentes-runner/orgs/<localId>/` and runs the bundled sidecar
//! `agentes-runner app --home <dir>`. Its stdout carries one JSON line per message of the
//! control protocol (`packages/adapters/src/runner-control.ts`); we forward every line to the
//! web views as the `runner://line` event, tagged with the home id, and write the web view's
//! requests to its stdin. Product logic stays in the runner and in TypeScript: this file only
//! spawns, relays, restarts with backoff and stops.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Largest line either side accepts (`CONTROL_MAX_LINE`).
const MAX_LINE: usize = 1024 * 1024;
/// The sidecar's name in `bundle.externalBin` (`binaries/agentes-runner-<target triple>`).
const SIDECAR: &str = "agentes-runner";
/// How long a runner may take to finish after `shutdown` before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(4);

pub const LINE_EVENT: &str = "runner://line";
pub const STATE_EVENT: &str = "runner://state";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerInfo {
    pub home_id: String,
    pub dir: String,
    pub running: bool,
    /// The runner's `hello` line, kept so windows opened later still see it.
    pub hello: Option<serde_json::Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinePayload {
    home_id: String,
    line: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    home_id: String,
    running: bool,
    removed: bool,
}

struct Runner {
    dir: PathBuf,
    child: Option<CommandChild>,
    running: bool,
    hello: Option<serde_json::Value>,
    /// Stopped on purpose (removing the home, quitting): never restarted.
    stopping: bool,
    /// Bumped on every spawn, so a late exit of an old process can't touch the new one.
    generation: u64,
    /// Exits in a row without running a minute; drives the backoff.
    failures: u32,
    started_at: Option<Instant>,
}

#[derive(Default)]
pub struct Runners {
    inner: Mutex<BTreeMap<String, Runner>>,
    quitting: AtomicBool,
    shut_down: AtomicBool,
}

/// 1, 2, 4, 8, 16, 32, then 60 seconds.
pub(crate) fn backoff(failures: u32) -> Duration {
    let secs = 1u64 << failures.min(6);
    Duration::from_secs(secs.min(60))
}

/// Home ids are ours (random hex, or an organization's id for the server here's homes), but they come back
/// from the web view: never a path.
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn new_id() -> String {
    let mut bytes = [0u8; 8];
    // The system's random source, on Windows too (`/dev/urandom` exists only on a Mac and Linux).
    let filled = getrandom::fill(&mut bytes).is_ok();
    if !filled {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let mixed = nanos ^ ((std::process::id() as u128) << 64);
        bytes.copy_from_slice(&mixed.to_le_bytes()[..8]);
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn orgs_root(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".agentes-runner").join("orgs"))
}

fn make_private_dir(dir: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

fn emit_state(app: &AppHandle, home_id: &str, running: bool, removed: bool) {
    let _ = app.emit(
        STATE_EVENT,
        StatePayload {
            home_id: home_id.to_string(),
            running,
            removed,
        },
    );
}

impl Runners {
    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, Runner>> {
        // A panic while holding the lock must not take the whole app down with it.
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Whether any home is signed in to an organization (its config holds a token).
    pub fn any_paired(&self) -> bool {
        self.lock().values().any(|r| paired_home(&r.dir))
    }

    pub fn is_shut_down(&self) -> bool {
        self.shut_down.load(Ordering::SeqCst)
    }

    pub fn list(&self) -> Vec<RunnerInfo> {
        self.lock()
            .iter()
            .map(|(id, r)| RunnerInfo {
                home_id: id.clone(),
                dir: r.dir.to_string_lossy().into_owned(),
                running: r.running,
                hello: r.hello.clone(),
            })
            .collect()
    }

    /// Finds the homes on disk and starts one runner for each of the app's own (before any runs, attempts that
    /// never finished signing in go).
    pub fn start_all(&self, app: &AppHandle) {
        if let Ok(root) = orgs_root(app) {
            drop_unpaired(&root);
        }
        self.rescan(app);
    }

    /// Runs the homes of the app's on disk: the runner of each one that isn't running yet starts (new homes of
    /// the server here, `host_sync.rs`), and those that stopped being the app's stop (the server here's, once
    /// it no longer runs here); their homes stay on disk.
    pub fn rescan(&self, app: &AppHandle) {
        if self.is_quitting() {
            return;
        }
        let Ok(root) = orgs_root(app) else { return };
        let own = crate::local_server::answering_loopback(app);
        let homes = app_homes(&root, own.as_deref());
        let gone: Vec<String> = {
            let map = self.lock();
            let running: Vec<(String, PathBuf)> = map.iter().map(|(id, r)| (id.clone(), r.dir.clone())).collect();
            no_longer_ours(&running, &homes)
        };
        for id in gone {
            self.stop(&id);
            self.lock().remove(&id);
            emit_state(app, &id, false, true);
        }
        let mut ids = Vec::new();
        for (name, dir) in homes {
            let mut map = self.lock();
            if !map.contains_key(&name) {
                map.insert(name.clone(), Runner::new(dir));
                ids.push(name);
            }
        }
        for id in ids {
            if let Err(err) = self.spawn(app, &id) {
                eprintln!("agentes: could not start the runner for {id}: {err}");
                self.schedule_restart(app, &id);
            }
        }
    }

    pub fn has(&self, home_id: &str) -> bool {
        self.lock().contains_key(home_id)
    }

    /// Stops a home's runner and starts it again (its connection's token changed on disk).
    pub fn restart(&self, app: &AppHandle, home_id: &str) {
        if !self.has(home_id) {
            return;
        }
        self.stop(home_id);
        if let Err(err) = self.spawn(app, home_id) {
            eprintln!("agentes: could not restart the runner for {home_id}: {err}");
            self.schedule_restart(app, home_id);
        }
    }

    /// A new, empty home (the caller then sends `pair.start`).
    pub fn add(&self, app: &AppHandle) -> Result<String, String> {
        let root = orgs_root(app)?;
        let id = new_id();
        let dir = root.join(&id);
        make_private_dir(&root)?;
        make_private_dir(&dir)?;
        self.lock().insert(id.clone(), Runner::new(dir));
        self.spawn(app, &id)?;
        Ok(id)
    }

    pub fn spawn(&self, app: &AppHandle, home_id: &str) -> Result<(), String> {
        {
            let mut map = self.lock();
            let runner = map.get_mut(home_id).ok_or("unknown home")?;
            if runner.child.is_some() {
                return Ok(());
            }
            let dir = runner.dir.to_string_lossy().into_owned();
            let command = app
                .shell()
                .sidecar(SIDECAR)
                .map_err(|e| e.to_string())?
                .args(["app", "--home", dir.as_str()]);
            let (mut rx, child) = command.spawn().map_err(|e| e.to_string())?;
            runner.generation += 1;
            runner.child = Some(child);
            runner.running = true;
            runner.hello = None;
            runner.stopping = false;
            runner.started_at = Some(Instant::now());
            let generation = runner.generation;

            let app = app.clone();
            let id = home_id.to_string();
            tauri::async_runtime::spawn(async move {
                let mut lines = LineSplitter::default();
                let mut exit_code: Option<i32> = None;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            for line in lines.push(&bytes) {
                                handle_line(&app, &id, generation, &line);
                            }
                        }
                        CommandEvent::Terminated(payload) => {
                            exit_code = payload.code;
                            break;
                        }
                        _ => {}
                    }
                }
                let runners = app.state::<Runners>();
                runners.on_exit(&app, &id, generation, exit_code);
            });
        }
        emit_state(app, home_id, true, false);
        Ok(())
    }

    fn on_exit(&self, app: &AppHandle, home_id: &str, generation: u64, code: Option<i32>) {
        let restart = {
            let mut map = self.lock();
            let Some(runner) = map.get_mut(home_id) else { return };
            if runner.generation != generation {
                return;
            }
            runner.child = None;
            runner.running = false;
            if runner.stopping || self.quitting.load(Ordering::SeqCst) {
                false
            } else {
                eprintln!("agentes: the runner for {home_id} exited ({code:?}); restarting");
                true
            }
        };
        emit_state(app, home_id, false, false);
        if restart {
            self.schedule_restart(app, home_id);
        }
    }

    /// Starts the runner again after the backoff, unless it was stopped meanwhile.
    fn schedule_restart(&self, app: &AppHandle, home_id: &str) {
        let delay = {
            let mut map = self.lock();
            let Some(runner) = map.get_mut(home_id) else { return };
            let ran = runner.started_at.map(|t| t.elapsed()).unwrap_or_default();
            if ran > Duration::from_secs(60) {
                runner.failures = 0;
            }
            let delay = backoff(runner.failures);
            runner.failures = runner.failures.saturating_add(1);
            delay
        };
        let app = app.clone();
        let id = home_id.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            let runners = app.state::<Runners>();
            if runners.quitting.load(Ordering::SeqCst) {
                return;
            }
            let wanted = runners
                .lock()
                .get(&id)
                .map(|r| !r.stopping && r.child.is_none())
                .unwrap_or(false);
            if wanted {
                if let Err(err) = runners.spawn(&app, &id) {
                    eprintln!("agentes: could not restart the runner for {id}: {err}");
                    runners.schedule_restart(&app, &id);
                }
            }
        });
    }

    pub fn send(&self, home_id: &str, line: &str) -> Result<(), String> {
        if line.len() > MAX_LINE || line.contains('\n') {
            return Err("bad line".into());
        }
        let mut map = self.lock();
        let runner = map.get_mut(home_id).ok_or("unknown home")?;
        let child = runner.child.as_mut().ok_or("not running")?;
        let mut bytes = Vec::with_capacity(line.len() + 1);
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
        child.write(&bytes).map_err(|e| e.to_string())
    }

    /// Asks the runner to finish (`shutdown`) and waits; kills it after the grace period.
    fn stop(&self, home_id: &str) {
        {
            let mut map = self.lock();
            let Some(runner) = map.get_mut(home_id) else { return };
            runner.stopping = true;
            if let Some(child) = runner.child.as_mut() {
                let _ = child.write(b"{\"id\":\"app-shutdown\",\"type\":\"shutdown\"}\n");
            }
        }
        self.wait_or_kill(&[home_id.to_string()]);
    }

    fn wait_or_kill(&self, ids: &[String]) {
        let deadline = Instant::now() + STOP_GRACE;
        while Instant::now() < deadline {
            let any_running = {
                let map = self.lock();
                ids.iter().any(|id| map.get(id).map(|r| r.child.is_some()).unwrap_or(false))
            };
            if !any_running {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let mut map = self.lock();
        for id in ids {
            if let Some(runner) = map.get_mut(id) {
                if let Some(child) = runner.child.take() {
                    let _ = child.kill();
                }
                runner.running = false;
            }
        }
    }

    /// Leaving an organization: stop its runner and delete its home. The agents' workspace
    /// (`~/agentes/<org>`) lives outside the home and stays on disk.
    pub fn remove(&self, app: &AppHandle, home_id: &str) -> Result<(), String> {
        if !valid_id(home_id) {
            return Err("bad home id".into());
        }
        self.stop(home_id);
        let dir = self.lock().remove(home_id).map(|r| r.dir);
        if let Some(dir) = dir {
            let root = orgs_root(app)?;
            if dir.starts_with(&root) && dir != root {
                let _ = fs::remove_dir_all(&dir);
            }
        }
        emit_state(app, home_id, false, true);
        Ok(())
    }

    /// Quitting the app: every runner gets `shutdown`, then a short wait, then a kill.
    pub fn shutdown_all(&self) {
        if self.quitting.swap(true, Ordering::SeqCst) {
            return;
        }
        let ids: Vec<String> = {
            let mut map = self.lock();
            for runner in map.values_mut() {
                runner.stopping = true;
                if let Some(child) = runner.child.as_mut() {
                    let _ = child.write(b"{\"id\":\"app-shutdown\",\"type\":\"shutdown\"}\n");
                }
            }
            map.keys().cloned().collect()
        };
        self.wait_or_kill(&ids);
        self.shut_down.store(true, Ordering::SeqCst);
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }
}

impl Runner {
    fn new(dir: PathBuf) -> Self {
        Runner {
            dir,
            child: None,
            running: false,
            hello: None,
            stopping: false,
            generation: 0,
            failures: 0,
            started_at: None,
        }
    }
}

/// Cuts the runner's stdout into lines. The shell plugin hands over one line per event with its
/// newline stripped, but a chunk may also be part of a line or several lines, so both are handled:
/// a newline ends a line, and so does a left-over that is a complete JSON object.
///
/// A left-over that never became JSON (stray output on stdout) used to stay in the buffer and glue
/// itself to every line after it, so no line got through until the buffer outgrew `MAX_LINE`. Now
/// it is dropped as soon as a chunk arrives that is a whole JSON line on its own.
#[derive(Default)]
struct LineSplitter {
    buf: Vec<u8>,
}

/// A whole protocol line: every message is one JSON object (a bare number or string could be the
/// tail of a line cut in two).
fn is_json(bytes: &[u8]) -> bool {
    bytes.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'{')
        && matches!(serde_json::from_slice::<serde_json::Value>(bytes), Ok(serde_json::Value::Object(_)))
}

impl LineSplitter {
    fn push(&mut self, chunk: &[u8]) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        if !self.buf.is_empty() {
            let first = match chunk.iter().position(|b| *b == b'\n') {
                Some(pos) => &chunk[..pos],
                None => chunk,
            };
            if is_json(first) {
                let mut joined = self.buf.clone();
                joined.extend_from_slice(first);
                if !is_json(&joined) {
                    self.buf.clear();
                }
            }
        }
        self.buf.extend_from_slice(chunk);
        while let Some(pos) = self.buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=pos).collect();
            out.push(line);
        }
        if is_json(&self.buf) {
            out.push(std::mem::take(&mut self.buf));
        }
        if self.buf.len() > MAX_LINE {
            self.buf.clear();
        }
        out
    }
}

fn handle_line(app: &AppHandle, home_id: &str, generation: u64, raw: &[u8]) {
    let text = String::from_utf8_lossy(raw);
    let line = text.trim();
    if line.is_empty() || line.len() > MAX_LINE {
        return;
    }
    if line.contains("\"hello\"") {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
            if value.get("type").and_then(|t| t.as_str()) == Some("hello") {
                let runners = app.state::<Runners>();
                let mut map = runners.lock();
                if let Some(runner) = map.get_mut(home_id) {
                    if runner.generation == generation {
                        runner.hello = Some(value);
                    }
                }
            }
        }
    }
    let _ = app.emit(
        LINE_EVENT,
        LinePayload {
            home_id: home_id.to_string(),
            line: line.to_string(),
        },
    );
}

/// The homes on disk the app runs, by id: every signed-in home but the ones another program keeps
/// (`managedBy: "host"`, a terminal install's `agentes-runner host` shares this folder), unless they are the
/// server here's own (`own_server`, its loopback address).
pub fn app_homes(root: &std::path::Path, own_server: Option<&str>) -> Vec<(String, PathBuf)> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_dir || !valid_id(&name) || !entry.path().join("config.json").exists() {
            continue;
        }
        let config = home_config(&entry.path());
        let host = config.as_ref().is_some_and(|c| c.get("managedBy").and_then(|m| m.as_str()) == Some("host"));
        if !host || config.as_ref().is_some_and(|c| crate::host_sync::is_host_home(c, own_server)) {
            out.push((name, entry.path()));
        }
    }
    out.sort();
    out
}

/// Homes without a config never finished signing in (the runner writes it on pairing): they go, so failed
/// attempts don't pile up. Only while no runner runs: a pairing in progress has none yet either.
fn drop_unpaired(root: &std::path::Path) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && valid_id(&name) && !entry.path().join("config.json").exists() {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// The running homes that aren't among the app's homes any more (`homes`); one still signing in (no config
/// yet) stays.
fn no_longer_ours(running: &[(String, PathBuf)], homes: &[(String, PathBuf)]) -> Vec<String> {
    running
        .iter()
        .filter(|(id, dir)| dir.join("config.json").exists() && !homes.iter().any(|(h, _)| h == id))
        .map(|(id, _)| id.clone())
        .collect()
}

fn home_config(dir: &std::path::Path) -> Option<serde_json::Value> {
    let text = fs::read_to_string(dir.join("config.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// A home's `config.json` has a machine token: it is signed in (the token itself is never read further).
fn paired_home(dir: &std::path::Path) -> bool {
    fs::read_to_string(dir.join("config.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(|t| !t.is_empty()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{app_homes, drop_unpaired, no_longer_ours, LineSplitter};
    use std::path::PathBuf;

    #[test]
    fn no_homes_no_runner_and_a_terminal_install_s_homes_left_alone() {
        let root = std::env::temp_dir().join(format!("agentes-homes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        assert!(app_homes(&root, None).is_empty());
        std::fs::create_dir_all(&root).unwrap();
        assert!(app_homes(&root, None).is_empty());
        for (id, config) in [
            ("a1b2c3d4", Some(r#"{"server":"https://agentes.tail1234.ts.net","token":"agm_x"}"#)),
            ("0e7c1d2a-0000-4000-8000-000000000001", Some(r#"{"server":"http://127.0.0.1:3000","managedBy":"host"}"#)),
            ("deadbeef", None),
        ] {
            std::fs::create_dir_all(root.join(id)).unwrap();
            if let Some(c) = config {
                std::fs::write(root.join(id).join("config.json"), c).unwrap();
            }
        }
        let ids: Vec<String> = app_homes(&root, None).into_iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["a1b2c3d4".to_string()]);
        assert!(root.join("deadbeef").exists(), "a pairing in progress keeps its home while runners run");
        drop_unpaired(&root);
        assert!(!root.join("deadbeef").exists(), "at start, an attempt that never paired goes");
        assert!(root.join("0e7c1d2a-0000-4000-8000-000000000001").exists());
        // The server the app runs here at another address: still a terminal install's home.
        assert_eq!(app_homes(&root, Some("http://127.0.0.1:4310")).len(), 1);
        // The server the app runs here: its host homes are the app's.
        let ids: Vec<String> = app_homes(&root, Some("http://127.0.0.1:3000")).into_iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["0e7c1d2a-0000-4000-8000-000000000001".to_string(), "a1b2c3d4".to_string()]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_server_here_s_homes_stop_once_it_no_longer_runs_here() {
        let root = std::env::temp_dir().join(format!("agentes-ours-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let host = "0e7c1d2a-0000-4000-8000-000000000001";
        for (id, config) in [
            ("a1b2c3d4", Some(r#"{"server":"https://agentes.tail1234.ts.net","token":"agm_x"}"#)),
            (host, Some(r#"{"server":"http://127.0.0.1:4310","managedBy":"host","token":"agm_y"}"#)),
            ("feedf00d", None),
        ] {
            std::fs::create_dir_all(root.join(id)).unwrap();
            if let Some(c) = config {
                std::fs::write(root.join(id).join("config.json"), c).unwrap();
            }
        }
        let running: Vec<(String, PathBuf)> =
            ["a1b2c3d4", host, "feedf00d"].iter().map(|id| (id.to_string(), root.join(id))).collect();
        assert!(no_longer_ours(&running, &app_homes(&root, Some("http://127.0.0.1:4310"))).is_empty());
        // Stopped running here: its host home stops (and stays on disk); a pairing in progress goes on.
        assert_eq!(no_longer_ours(&running, &app_homes(&root, None)), vec![host.to_string()]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    fn texts(lines: Vec<Vec<u8>>) -> Vec<String> {
        lines.into_iter().map(|l| String::from_utf8(l).unwrap().trim().to_string()).collect()
    }

    #[test]
    fn whole_lines_without_newlines() {
        let mut s = LineSplitter::default();
        assert_eq!(texts(s.push(br#"{"a":1}"#)), vec![r#"{"a":1}"#]);
        assert_eq!(texts(s.push(br#"{"b":2}"#)), vec![r#"{"b":2}"#]);
    }

    #[test]
    fn several_lines_and_pieces() {
        let mut s = LineSplitter::default();
        assert_eq!(texts(s.push(b"{\"a\":1}\n{\"b\":")), vec![r#"{"a":1}"#]);
        assert_eq!(texts(s.push(b"2}\n")), vec![r#"{"b":2}"#]);
        assert_eq!(texts(s.push(b"{\"c\":{\"d\":")), Vec::<String>::new());
        assert_eq!(texts(s.push(b"3}}")), vec![r#"{"c":{"d":3}}"#]);
        // A tail that is valid JSON on its own (a number) is still a tail.
        assert_eq!(texts(s.push(b"{\"n\":12")), Vec::<String>::new());
        assert_eq!(texts(s.push(b"3")), Vec::<String>::new());
        assert_eq!(texts(s.push(b"}")), vec![r#"{"n":123}"#]);
    }

    #[test]
    fn stray_output_does_not_swallow_later_lines() {
        let mut s = LineSplitter::default();
        assert_eq!(texts(s.push(b"warning: something")), Vec::<String>::new());
        assert_eq!(texts(s.push(br#"{"type":"event"}"#)), vec![r#"{"type":"event"}"#]);
        assert_eq!(texts(s.push(br#"{"type":"reply"}"#)), vec![r#"{"type":"reply"}"#]);
    }
}
