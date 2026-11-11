//! The server here ("Run agentes.chat on this computer", ADR 0066): agentes.chat's native server (ADR 0060 §2,
//! one program with its database built in) as a child of the app, in `~/.agentes`. The app carries the
//! server's files (`server/` and `web/` among its resources) and runs them with its own runner binary acting as
//! Bun (`BUN_BE_BUN=1`), so nothing downloads and the server moves with the app's updates: on the first start
//! of each version its files are copied into `~/.agentes/app/<version>` (the previous copy and a copy of the
//! database stay, so a version that doesn't start goes back to them).
//!
//! The app makes the folder's secrets itself before the first start: `AGENTES_SECRET`, the owner key (only the
//! app holds it, `owner-key`; the server keeps its SHA-256, ADR 0060 §6) and `HOST_COMPUTER_TOKEN` (this
//! computer is the agents' computer, `host_sync.rs`). It writes `TELEMETRY` from the person's switch and
//! `INSTALL_MODE=desktop`. Long-lived secrets never reach a web view: the owner key only buys one-time sign-ins
//! (`/desktop/handover#token=…`) for the main window.
//!
//! A setup can be cancelled at every step, and one that doesn't finish leaves the computer as it was before: what
//! it started stops, and a database it made goes. While it makes one, `setup-pending` marks the folder's database
//! as nobody's until the last step is done (`discard_unowned`); the folder's settings and the server's copy stay.
//!
//! It starts the server with the app (at login too), restarts it after a crash (1 s doubling to 60 s), stops it
//! gracefully on quit, and listens only on 127.0.0.1; reach from the person's other devices is Tailscale's
//! `serve` (`tailscale.rs`), which also moves `PUBLIC_URL`, and is shared only while the server runs here.
//!
//! Other programs and accounts on this computer can listen on the loopback port too, so only the app's own
//! child counts as the server: it answers health and names its pid in `server.json` (in the folder only this
//! person may write). Until then nothing gets the owner key, the computer's token or the main window's bridge.

use std::collections::VecDeque;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering::SeqCst};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Url};

/// The data folder, under the person's home.
const FOLDER: &str = ".agentes";
/// The app's own record of the server here, in its config folder.
const HERE_FILE: &str = "local-server.json";
/// The ports a new folder may take (apps/server native.ts `NATIVE_PORTS`): not 3000, the Docker install's.
const PORTS: std::ops::RangeInclusive<u16> = 4310..=4329;
/// Starts in a row that don't answer `/api/health` in this long, all together, failed: no more tries (a first
/// start migrates a new database).
const ANSWER_WITHIN: Duration = Duration::from_secs(180);
/// How long the server gets to drain on a stop before it is killed (it drains in 20 s itself).
const STOP_GRACE: Duration = Duration::from_secs(25);
/// Starts in a row that never answered before the app stops trying (and an update goes back).
const MAX_FAILED_STARTS: u32 = 3;
/// An update's `db dump` and `db restore`, each: never cut short in normal use, but a hung one ends.
const MOVE_WAIT: Duration = Duration::from_secs(30 * 60);
/// Stops this close together are worth a notification.
const STOPS_WINDOW: Duration = Duration::from_secs(600);
/// Database copies kept in `backups/` (besides "Back up now"'s, of which the two newest stay too).
const KEEP_COPIES: usize = 2;
/// The page's own lines and the server's (and the setup's timeline), kept for "Copy details".
const STDERR_LINES: usize = 60;

pub const STATUS_EVENT: &str = "local-server://status";
pub const STEP_EVENT: &str = "local-server://step";
/// What turning reach on or off is doing now, for the windows to say while it takes.
pub const REACH_EVENT: &str = "local-server://reach";

/// Exit codes of `agentes-server` (apps/server native.ts `EXIT`).
mod exit {
    pub const LOCKED: i32 = 3;
    pub const UPGRADE: i32 = 4;
    pub const PORT: i32 = 5;
}

// ───────────────────────────── the folder ─────────────────────────────

/// A data folder, laid out as `agentes-server` keeps it (apps/server native.ts `nativeFiles`), plus the files
/// only the app writes there.
#[derive(Clone, Debug)]
pub struct Folder(pub PathBuf);

impl Folder {
    pub fn env(&self) -> PathBuf {
        self.0.join(".env")
    }
    pub fn owner_key(&self) -> PathBuf {
        self.0.join("owner-key")
    }
    pub fn host_token(&self) -> PathBuf {
        self.0.join("host-computer-token")
    }
    /// A terminal install's owner claim, while it waits for its owner (the setup's).
    pub fn claim(&self) -> PathBuf {
        self.0.join("owner-claim")
    }
    /// There while a setup makes the database, until its last step is done.
    pub fn pending(&self) -> PathBuf {
        self.0.join("setup-pending")
    }
    fn apps(&self) -> PathBuf {
        self.0.join("app")
    }
    pub fn copy(&self, version: &str) -> PathBuf {
        self.apps().join(version)
    }
    fn current(&self) -> PathBuf {
        self.apps().join("current")
    }
    pub fn db(&self) -> PathBuf {
        self.0.join("db")
    }
    pub fn backups(&self) -> PathBuf {
        self.0.join("backups")
    }
    pub fn log(&self) -> PathBuf {
        self.0.join("logs").join("server.log")
    }
    pub fn ready(&self) -> PathBuf {
        self.0.join("server.json")
    }
    fn lock(&self) -> PathBuf {
        self.0.join("server.lock")
    }
    /// The server's entry in a version's copy (`scripts/native-package.ts`).
    pub fn entry(&self, version: &str) -> PathBuf {
        self.copy(version).join("server").join("native.js")
    }
}

/// What `~/.agentes` holds: nothing, the app's own server (its owner key is there), or one installed from the
/// terminal, which the app only connects to.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Installed {
    None,
    App,
    Terminal,
}

pub fn installed(folder: &Folder) -> Installed {
    if folder.owner_key().is_file() {
        Installed::App
    } else if folder.env().is_file() || folder.ready().is_file() {
        Installed::Terminal
    } else {
        Installed::None
    }
}

// ───────────────────────────── settings (.env) ─────────────────────────────

/// One `KEY=value` line as packages/setup `envEntries` reads it (`export` allowed; quotes taken off; an
/// unquoted ` # …` is a comment).
fn env_line(line: &str) -> Option<(&str, String)> {
    let line = line.trim_start();
    let line = line.strip_prefix("export ").map(str::trim_start).unwrap_or(line);
    let (key, value) = line.split_once('=')?;
    let key = key.trim_end();
    let mut chars = key.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    let raw = value.trim();
    let unquoted = match raw.chars().next() {
        Some(q @ ('\'' | '"')) if raw.len() >= 2 && raw.ends_with(q) => {
            let inner = &raw[1..raw.len() - 1];
            if q == '"' {
                inner.replace("\\\"", "\"").replace("\\\\", "\\")
            } else {
                inner.to_string()
            }
        }
        _ => raw.split(" #").next().unwrap_or("").trim_end().to_string(),
    };
    Some((key, unquoted))
}

pub fn env_get(text: &str, key: &str) -> Option<String> {
    text.lines().filter_map(env_line).find(|(k, _)| *k == key).map(|(_, v)| v)
}

/// Every value the app writes is plain (`[A-Za-z0-9_@%+=:,./-]`); anything else goes in single quotes.
fn env_value(value: &str) -> String {
    let flat: String = value.chars().filter(|c| *c != '\n' && *c != '\r').collect();
    if flat.chars().all(|c| c.is_ascii_alphanumeric() || "_@%+=:,./-".contains(c)) {
        flat
    } else {
        format!("'{}'", flat.replace('\'', ""))
    }
}

/// Rewrites each key where it first appears, drops its other lines and appends the keys the file lacks;
/// comments and every other line stay (packages/setup `upsertEnv`).
pub fn env_set(text: &str, entries: &[(&str, String)]) -> String {
    let mut written: Vec<&str> = Vec::new();
    let mut lines: Vec<String> = Vec::new();
    for line in text.split('\n') {
        match env_line(line).and_then(|(k, _)| entries.iter().find(|(key, _)| *key == k)) {
            None => lines.push(line.to_string()),
            Some((key, value)) => {
                if !written.contains(key) {
                    written.push(key);
                    lines.push(format!("{key}={}", env_value(value)));
                }
            }
        }
    }
    let missing: Vec<_> = entries.iter().filter(|(k, _)| !written.contains(k)).collect();
    if !missing.is_empty() {
        while lines.last().is_some_and(|l| l.is_empty()) {
            lines.pop();
        }
        for (key, value) in missing {
            lines.push(format!("{key}={}", env_value(value)));
        }
        lines.push(String::new());
    }
    lines.join("\n")
}

fn read_env(folder: &Folder) -> String {
    fs::read_to_string(folder.env()).unwrap_or_default()
}

fn write_env(folder: &Folder, entries: &[(&str, String)]) -> io::Result<()> {
    let next = env_set(&read_env(folder), entries);
    write_private(&folder.env(), next.as_bytes(), true)
}

const ENV_HEADER: &str = "# agentes.chat on this computer, run by the agentes.chat app. Help:\n\
# https://agentes.chat/docs/run-on-your-computer. AGENTES_SECRET encrypts the keys stored in the database: it\n\
# travels with the folder in a backup, and changing it makes them unreadable.\n";

/// The port the server takes and the address it answers at.
pub fn port_of(folder: &Folder) -> Option<u16> {
    env_get(&read_env(folder), "PORT")?.parse().ok()
}

pub fn loopback_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

// ───────────────────────────── secrets and files ─────────────────────────────

/// `n` bytes from the system's secure random source (`/dev/urandom` doesn't exist on Windows: reading it there
/// failed the setup, or read whatever file someone put at `C:\dev\urandom`).
fn random(n: usize) -> io::Result<Vec<u8>> {
    let mut bytes = vec![0u8; n];
    getrandom::fill(&mut bytes)?;
    Ok(bytes)
}

pub fn sha256_hex(text: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn make_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// A file only this person may read, written whole (through a temporary file when `replace`), or created once.
fn write_private(path: &Path, bytes: &[u8], replace: bool) -> io::Result<()> {
    let mut open = fs::OpenOptions::new();
    open.write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        open.mode(0o600);
    }
    if replace {
        let tmp = path.with_extension("tmp");
        let _ = fs::remove_file(&tmp);
        open.create_new(true).open(&tmp)?.write_all(bytes)?;
        fs::rename(&tmp, path)
    } else {
        open.create_new(true).open(path)?.write_all(bytes)
    }
}

/// What the person chose in "Run agentes.chat on this computer".
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub name: Option<String>,
    pub email: Option<String>,
    pub reach: bool,
    pub usage: bool,
}

/// Makes the folder and its settings the first time (the secrets, a free port, the address), and keeps the
/// person's usage choice and the install's kind in `.env` every time. Never replaces a secret it already has.
pub fn prepare(folder: &Folder, usage: bool, free_port: impl Fn() -> Option<u16>) -> io::Result<()> {
    use base64::Engine;
    make_private_dir(&folder.0)?;
    if !folder.owner_key().exists() {
        let key = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random(32)?);
        write_private(&folder.owner_key(), key.as_bytes(), false)?;
    }
    if !folder.host_token().exists() {
        let token = base64::engine::general_purpose::STANDARD.encode(random(48)?);
        write_private(&folder.host_token(), token.as_bytes(), false)?;
    }
    let key = fs::read_to_string(folder.owner_key())?;
    let token = fs::read_to_string(folder.host_token())?;
    let env = read_env(folder);
    let mut entries: Vec<(&str, String)> = vec![
        ("TELEMETRY", if usage { "on" } else { "off" }.to_string()),
        ("INSTALL_MODE", "desktop".to_string()),
        ("OWNER_KEY_SHA256", sha256_hex(key.trim())),
        ("HOST_COMPUTER_TOKEN", token.trim().to_string()),
    ];
    if env_get(&env, "AGENTES_SECRET").is_none() {
        entries.push(("AGENTES_SECRET", base64::engine::general_purpose::STANDARD.encode(random(48)?)));
    }
    if env_get(&env, "PORT").is_none() {
        let port = free_port().ok_or_else(|| io::Error::other("no free port between 4310 and 4329"))?;
        entries.push(("PORT", port.to_string()));
        entries.push(("PUBLIC_URL", loopback_url(port)));
    }
    if env.is_empty() {
        write_private(&folder.env(), ENV_HEADER.as_bytes(), true)?;
    }
    write_env(folder, &entries)
}

/// `TELEMETRY` as the server reads it (packages/config: a boolean string, on when unset).
fn telemetry_on(value: Option<&str>) -> bool {
    !value.is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "off" | "false" | "0" | "no" | "n" | "disabled"))
}

/// The first port of the range nothing listens on.
pub fn free_port() -> Option<u16> {
    PORTS.into_iter().find(|p| port_free(*p))
}

/// Free as the server judges it (it exits 5 when something answers on 127.0.0.1 there), and bindable. A bind alone
/// isn't enough: on a Mac, Rust's bind of 127.0.0.1 succeeds beside another program's `*:port` or `[::]:port`.
fn port_free(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    std::net::TcpListener::bind(addr).is_ok() && TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_err()
}

// ───────────────────────────── the app's copies of the server ─────────────────────────────

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// The version `app/current` points at (on Windows, where a link needs more rights, the file names it).
pub fn current_version(folder: &Folder) -> Option<String> {
    #[cfg(unix)]
    {
        fs::read_link(folder.current()).ok()?.file_name()?.to_str().map(str::to_string)
    }
    #[cfg(not(unix))]
    {
        let version = fs::read_to_string(folder.current()).ok()?.trim().to_string();
        (!version.is_empty() && !version.contains(['/', '\\']) && version != "..").then_some(version)
    }
}

fn set_current(folder: &Folder, version: &str) -> io::Result<()> {
    let tmp = folder.apps().join("current.tmp");
    let _ = fs::remove_file(&tmp);
    #[cfg(unix)]
    std::os::unix::fs::symlink(version, &tmp)?;
    #[cfg(not(unix))]
    fs::write(&tmp, version)?;
    fs::rename(&tmp, folder.current())
}

/// The newest entries of `dir` whose names start with `prefix` stay (`keep` of them); the rest go.
fn prune(dir: &Path, prefix: &str, keep: usize, except: &[&str]) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut names: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            name.starts_with(prefix) && !except.contains(&name.as_str()) && name != "current" && !name.ends_with(".tmp")
        })
        .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH), e.path()))
        .collect();
    names.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in names.into_iter().skip(keep) {
        let _ = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
    }
}

/// What a start of `version` needs first.
#[derive(Debug, PartialEq)]
pub enum Copied {
    /// That copy is already the current one.
    Same,
    /// A new copy, the first one in this folder.
    First,
    /// A new version: `from` was current, and the database was copied to `backups/db-<from>` first.
    Update { from: String },
}

/// Copies the app's server (`<bundle>/server`, `<bundle>/web`) into `app/<version>` unless it is there, points
/// `app/current` at it, and before a version change copies the database aside. Keeps the previous copy.
pub fn install_version(folder: &Folder, bundle: &Path, version: &str) -> io::Result<Copied> {
    let before = current_version(folder);
    if before.as_deref() == Some(version) && folder.entry(version).is_file() {
        return Ok(Copied::Same);
    }
    make_private_dir(&folder.apps())?;
    if !folder.entry(version).is_file() {
        let tmp = folder.apps().join(format!("{version}.tmp"));
        let _ = fs::remove_dir_all(&tmp);
        for part in ["server", "web"] {
            copy_dir(&bundle.join(part), &tmp.join(part))?;
        }
        let _ = fs::remove_dir_all(folder.copy(version));
        fs::rename(&tmp, folder.copy(version))?;
    }
    let copied = match before.filter(|b| b != version && folder.entry(b).is_file()) {
        Some(from) => {
            if folder.db().is_dir() {
                not_held(folder)?;
                make_private_dir(&folder.backups())?;
                let aside = folder.backups().join(format!("db-{from}"));
                let _ = fs::remove_dir_all(&aside);
                copy_dir(&folder.db(), &aside)?;
                prune(&folder.backups(), "db-", KEEP_COPIES, &[]);
            }
            Copied::Update { from }
        }
        None => Copied::First,
    };
    set_current(folder, version)?;
    let keep = match &copied {
        Copied::Update { from } => vec![from.as_str(), version],
        _ => vec![version],
    };
    prune(&folder.apps(), "", 0, &keep);
    Ok(copied)
}

/// An update that didn't start: the previous copy is current again, with the database as it was before.
pub fn go_back(folder: &Folder, from: &str, to: &str) -> io::Result<()> {
    let aside = folder.backups().join(format!("db-{to}"));
    if aside.is_dir() {
        not_held(folder)?;
        let failed = folder.backups().join(format!("failed-db-{from}-{}", stamp()));
        if folder.db().is_dir() {
            fs::rename(folder.db(), &failed)?;
        }
        copy_dir(&aside, &folder.db())?;
        prune(&folder.backups(), "failed-db-", 1, &[]);
    }
    set_current(folder, to)
}

fn stamp() -> String {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0).to_string()
}

// ───────────────────────────── talking to it ─────────────────────────────

/// One HTTP/1.1 request to the server on this computer's loopback (`Host` is its own address, which it
/// answers); the status and the body.
pub fn http(port: u16, method: &str, path: &str, body: Option<&Value>) -> Option<(u16, String)> {
    http_within(port, method, path, body, Duration::from_secs(15))
}

/// `http`, waiting at most `read` for each read of the answer.
pub fn http_within(port: u16, method: &str, path: &str, body: Option<&Value>, read: Duration) -> Option<(u16, String)> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).ok()?;
    stream.set_read_timeout(Some(read)).ok()?;
    let body = body.map(Value::to_string).unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nAccept: application/json\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut raw = Vec::new();
    stream.take(4 * 1024 * 1024).read_to_end(&mut raw).ok()?;
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let rest = &raw[split + 4..];
    let status = head.split_whitespace().nth(1)?.parse().ok()?;
    let chunked = head.lines().any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    let body = if chunked { dechunk(rest) } else { rest.to_vec() };
    Some((status, String::from_utf8_lossy(&body).into_owned()))
}

/// A chunked body, by bytes: chunk sizes count bytes, which may end inside a character.
fn dechunk(mut rest: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(end) = rest.windows(2).position(|w| w == b"\r\n") {
        let size = std::str::from_utf8(&rest[..end]).ok().and_then(|s| s.split(';').next());
        let Some(n) = size.and_then(|s| usize::from_str_radix(s.trim(), 16).ok()) else { break };
        let after = &rest[end + 2..];
        if n == 0 || after.len() < n {
            break;
        }
        out.extend_from_slice(&after[..n]);
        rest = after[n..].strip_prefix(b"\r\n").unwrap_or(&after[n..]);
    }
    out
}

pub fn healthy(port: u16) -> bool {
    matches!(http(port, "GET", "/api/health", None), Some((200, _)))
}

/// A one-time sign-in for the owner, and the owner's account id when the server says it (newer servers do).
pub fn owner_sign_in_as(folder: &Folder, port: u16) -> Result<(String, Option<String>), u16> {
    let key = fs::read_to_string(folder.owner_key()).map_err(|_| 0u16)?;
    match http(port, "POST", "/api/auth/owner-key", Some(&json!({ "key": key.trim() }))) {
        Some((200, text)) => {
            let body = serde_json::from_str::<Value>(&text).map_err(|_| 0u16)?;
            let token = body["token"]
                .as_str()
                .filter(|t| crate::servers::page_path(&format!("/desktop/handover#token={t}")))
                .ok_or(0u16)?;
            Ok((token.to_string(), body["userId"].as_str().map(str::to_string)))
        }
        Some((status, _)) => Err(status),
        None => Err(0),
    }
}

/// Whether the window, signed in there as `was`, goes on signed in as the owner: only when that is who it was (or the
/// server doesn't say who its owner is, as before). Signed out, or someone else: the sign-in page instead, where
/// the owner still continues on this computer in one click.
pub fn sign_in_owner(was: Option<&str>, owner: Option<&str>) -> bool {
    match (was, owner) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(was), Some(owner)) => was == owner,
    }
}

/// The window follows the server to `url`: signed in as the owner when it was the owner (`sign_in_owner`), else on
/// that address's sign-in page.
fn follow_window(app: &AppHandle, folder: &Folder, port: u16, url: &str, was: Option<String>) -> Result<(), String> {
    if was.is_some() {
        if let Ok((token, owner)) = owner_sign_in_as(folder, port) {
            if sign_in_owner(was.as_deref(), owner.as_deref()) {
                return open_signed_in(app, url, &token);
            }
        }
    }
    let page: Url = url.parse().map_err(|_| "not a URL")?;
    crate::main_window::show_url(app, page)
}

/// A one-time sign-in for the owner (`POST /api/auth/owner-key`, ADR 0060 §6); with `who`, the owner is made
/// first when there is none. Err: the server's status, or 0 when it didn't answer.
pub fn owner_sign_in(folder: &Folder, port: u16, who: Option<(&str, &str)>) -> Result<String, u16> {
    let key = fs::read_to_string(folder.owner_key()).map_err(|_| 0u16)?;
    let mut body = json!({ "key": key.trim() });
    if let Some((name, email)) = who {
        body["name"] = json!(name.trim());
        body["email"] = json!(email.trim());
    }
    match http(port, "POST", "/api/auth/owner-key", Some(&body)) {
        Some((200, text)) => serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v["token"].as_str().map(str::to_string))
            .filter(|t| crate::servers::page_path(&format!("/desktop/handover#token={t}")))
            .ok_or(0),
        Some((status, _)) => Err(status),
        None => Err(0),
    }
}

// ───────────────────────────── the child ─────────────────────────────

/// How the server is started: a Bun (the app's runner binary with `BUN_BE_BUN=1`) on a copy's entry.
#[derive(Clone, Debug)]
pub struct Launch {
    pub bun: PathBuf,
    pub folder: Folder,
    pub version: String,
}

impl Launch {
    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(&self.bun);
        crate::no_console(&mut command)
            .arg(self.folder.entry(&self.version))
            .args(args)
            .arg("--data")
            .arg(&self.folder.0)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            // Only what the server needs: the person's shell may set PORT or DATABASE_URL, which would win
            // over the folder's own settings.
            .env_clear()
            .env("BUN_BE_BUN", "1");
        for key in ["HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TZ"].iter().chain(WINDOWS_ENV) {
            if let Ok(value) = std::env::var(key) {
                command.env(key, value);
            }
        }
        command
    }

    /// `agentes-server <args> --data <folder>` to its end (migrate, db dump/restore), at most `wait` and until
    /// `stop` says so.
    pub fn run(&self, args: &[&str], wait: Duration, stop: &dyn Fn() -> bool) -> io::Result<crate::Ran> {
        crate::run_program(&mut self.command(args), wait, stop)
    }

    pub fn spawn(&self) -> io::Result<Child> {
        #[cfg(unix)]
        {
            self.command(&[]).spawn()
        }
        #[cfg(not(unix))]
        {
            let mut child = self.command(&["--until-stdin-ends"]).stdin(Stdio::piped()).spawn()?;
            if let Some(pipe) = child.stdin.take() {
                stop_pipes().push((child.id(), pipe));
            }
            Ok(child)
        }
    }
}

/// What Windows itself needs in a program's environment (Bun finds the system, the person's folders and a
/// temporary folder through these); a Mac and Linux have none of them.
const WINDOWS_ENV: &[&str] = &[
    "SystemRoot",
    "SystemDrive",
    "windir",
    "ComSpec",
    "PATHEXT",
    "USERPROFILE",
    "USERNAME",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "TEMP",
    "TMP",
];

/// Windows has no SIGTERM: the app holds each server's stdin open, and closing it asks the server to drain and
/// stop (`--until-stdin-ends`, apps/server native.ts). When the app ends any other way the pipe closes too, so
/// no server is left running without it.
#[cfg(not(unix))]
fn stop_pipes() -> std::sync::MutexGuard<'static, Vec<(u32, std::process::ChildStdin)>> {
    static PIPES: Mutex<Vec<(u32, std::process::ChildStdin)>> = Mutex::new(Vec::new());
    PIPES.lock().unwrap_or_else(|e| e.into_inner())
}

/// The child `pid` ended: its pipe goes (Windows; a later process may get the same pid).
fn forget_pipe(pid: u32) {
    #[cfg(not(unix))]
    stop_pipes().retain(|(p, _)| *p != pid);
    #[cfg(unix)]
    let _ = pid;
}

/// Asks a process to stop (SIGTERM; on Windows its stdin closes), then kills it after `grace`.
fn stop_pid(pid: u32, grace: Duration, gone: impl Fn() -> bool) {
    #[cfg(unix)]
    {
        // SAFETY: a signal to a pid this app started.
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline && !gone() {
            std::thread::sleep(Duration::from_millis(100));
        }
        if !gone() {
            // SAFETY: as above.
            unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
            // Until it is gone: what comes next checks that no server holds the folder.
            let killed = Instant::now();
            while killed.elapsed() < Duration::from_secs(2) && !gone() {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    #[cfg(not(unix))]
    {
        // Dropping the pipe closes it.
        forget_pipe(pid);
        let deadline = Instant::now() + grace;
        while Instant::now() < deadline && !gone() {
            std::thread::sleep(Duration::from_millis(100));
        }
        if !gone() {
            let _ = crate::no_console(&mut Command::new("taskkill"))
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            let killed = Instant::now();
            while killed.elapsed() < Duration::from_secs(2) && !gone() {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

/// The pid a file of the folder names (`server.lock`, `server.json`).
fn pid_in(file: &Path) -> Option<u32> {
    let value: Value = serde_json::from_str(&fs::read_to_string(file).ok()?).ok()?;
    u32::try_from(value["pid"].as_u64()?).ok()
}

/// The pid `server.json` names: the server writes it once it listens, in the folder only this person can write.
fn ready_pid(folder: &Folder) -> Option<u32> {
    pid_in(&folder.ready())
}

/// A server that `file` names and that still runs (its own command line names `native.js`), with that line.
fn live_server(file: &Path) -> Option<(u32, String)> {
    #[cfg(unix)]
    {
        let pid = pid_in(file)?;
        if pid == std::process::id() || !pid_alive(pid) {
            return None;
        }
        let out = Command::new("ps").args(["-o", "command=", "-p", &pid.to_string()]).output().ok()?;
        let line = String::from_utf8_lossy(&out.stdout).into_owned();
        line.contains("native.js").then_some((pid, line))
    }
    #[cfg(not(unix))]
    {
        let _ = file;
        None
    }
}

/// A server of this folder that `file` names and that still runs: its own command line names `native.js` and
/// this folder. Anything else is left alone.
fn folder_server(folder: &Folder, file: &Path) -> Option<u32> {
    live_server(file).and_then(|(pid, line)| line.contains(&*folder.0.to_string_lossy()).then_some(pid))
}

/// The server that holds this folder's lock now, even one whose command line doesn't name the folder (started by
/// hand without `--data`, the default folder): never stopped by the app, and its database is never copied or moved
/// while it runs.
fn not_held(folder: &Folder) -> io::Result<()> {
    match live_server(&folder.lock()) {
        Some((pid, _)) => Err(io::Error::other(format!("another agentes-server (pid {pid}) uses {}", folder.0.display()))),
        None => Ok(()),
    }
}

/// A server left running from this folder by an app that ended without stopping it (killed, crashed).
fn leftover(folder: &Folder) -> Option<u32> {
    folder_server(folder, &folder.lock())
}

fn stop_leftover(app: &AppHandle, folder: &Folder) {
    if let Some(pid) = leftover(folder) {
        note(app, format!("stopping a server left running from this folder (pid {pid})"));
        stop_pid(pid, STOP_GRACE, || leftover(folder).is_none());
    }
}

/// A database a setup made and never finished (`setup-pending`) holds nothing of anyone's: it goes with `files/`,
/// so the next setup makes it from the start. Never one without the mark, never while a server holds the folder.
pub fn discard_unowned(folder: &Folder) {
    if !folder.pending().is_file() || not_held(folder).is_err() {
        return;
    }
    for part in [folder.db(), folder.0.join("files")] {
        // Windows may keep a file in use a moment after its program ended.
        for _ in 0..3 {
            if !part.exists() || fs::remove_dir_all(&part).is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    }
    // Still there: the mark stays, and the next setup removes it first.
    if !folder.db().exists() {
        let _ = fs::remove_file(folder.pending());
    }
}

// ───────────────────────────── what to do after an exit ─────────────────────────────

/// After the child stopped or never answered.
#[derive(Debug, PartialEq)]
pub enum Next {
    /// Stopped on purpose: nothing.
    Nothing,
    /// Start again after this long.
    Restart(Duration),
    /// The folder's database is another Postgres major's: dump with `from`'s copy, restore with this one's.
    Upgrade { from: Option<String> },
    /// Its port is taken now: another one, then start.
    NewPort,
    /// A new version that doesn't start: back to `to`.
    GoBack { to: String },
    /// Starts keep failing: stop trying (the person can try again).
    GiveUp,
}

/// The supervisor's rule. `failed`: starts in a row that never answered, this one included when `answered`
/// is false; `update_from`: the version that was current before this start's version, while it hasn't
/// answered yet.
pub fn next_after(on_purpose: bool, code: Option<i32>, answered: bool, failed: u32, update_from: Option<&str>) -> Next {
    if on_purpose {
        return Next::Nothing;
    }
    if !answered && code == Some(exit::UPGRADE) {
        return Next::Upgrade { from: update_from.map(str::to_string) };
    }
    if !answered && failed >= MAX_FAILED_STARTS {
        // A port or a folder another program holds says nothing about the version: going back wouldn't help.
        return match update_from {
            Some(to) if !matches!(code, Some(exit::PORT | exit::LOCKED)) => Next::GoBack { to: to.to_string() },
            _ => Next::GiveUp,
        };
    }
    if !answered && code == Some(exit::PORT) {
        return Next::NewPort;
    }
    Next::Restart(crate::runners::backoff(if answered { 0 } else { failed }))
}

/// Starts in a row that never answered, after one more: once their wait ran out it counts as all of them (no
/// second three minutes).
pub fn failed_starts(before: u32, timed_out: bool) -> u32 {
    if timed_out {
        MAX_FAILED_STARTS
    } else {
        before + 1
    }
}

// ───────────────────────────── the server here, in the app ─────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// The app doesn't run a server here.
    Off,
    Starting,
    /// A new version's first start (it migrates).
    Updating,
    Running,
    /// Stopped: by the person, or crashed and not starting again.
    Stopped,
    /// It stopped by itself and starts again in a moment (or moves its database, its port, its version first).
    Restarting,
    /// Starts keep failing.
    Failing,
}

/// The app's record (`local-server.json`): whether it runs the server here, whether its owner was made, and an
/// app version whose server didn't start, so it stays on the version it went back to until the next one.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct HereFile {
    run: bool,
    owner: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    skip: Option<String>,
    /// Stopped by the person to stay stopped: the app doesn't start it (not even when it opens again) until Start,
    /// or until `until` (Unix seconds) when it was "for an hour".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hold: Option<Hold>,
    /// A new version's first start hasn't answered yet: the version it updates from. Kept here, so an update cut
    /// short by quitting the app still moves the database or goes back to that version at the next start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    updating_from: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Hold {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    until: Option<u64>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// What a saved hold means at `now`: it stays stopped (until Start, or until a time still ahead), or the hold is
/// over (a time gone by, while the app was closed too).
pub fn hold_left(until: Option<u64>, now: u64) -> HoldLeft {
    match until {
        None => HoldLeft::UntilStart,
        Some(t) if t > now => HoldLeft::For(t - now),
        Some(_) => HoldLeft::Over,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HoldLeft {
    UntilStart,
    /// Seconds still to wait.
    For(u64),
    Over,
}

#[derive(Default)]
struct Inner {
    here: HereFile,
    phase: Option<Phase>,
    pid: Option<u32>,
    /// A start is copying files or stopping a leftover, before the child exists.
    launching: bool,
    generation: u64,
    on_purpose: bool,
    answered: bool,
    failed: u32,
    /// The first of the starts in a row that haven't answered: together they get `ANSWER_WITHIN`.
    trying_since: Option<Instant>,
    stops: VecDeque<Instant>,
    update_from: Option<String>,
    /// An update went back to this version (said once).
    back_to: Option<String>,
    lines: VecDeque<String>,
    https_url: Option<String>,
    /// Tailscale shares it now (with reach on); false once the server stopped here.
    served: bool,
    /// With reach on, Tailscale isn't connected on this computer (the last share or check said so): its devices can't
    /// reach it, whatever the address says.
    tailnet_down: bool,
    /// `caffeinate`'s process while it keeps this Mac awake for the people reaching the server through Tailscale.
    awake: Option<u32>,
    /// It is being set up, since then (Copy details' timeline counts from it).
    setting_up: Option<Instant>,
}

#[derive(Default)]
pub struct LocalServer {
    inner: Mutex<Inner>,
    /// One long operation at a time (setting up, reach, a backup, a restart).
    busy: Mutex<()>,
    /// Cancel, or the app quitting, while it is set up: every wait of the setup ends.
    cancel: AtomicBool,
    /// The person stopped waiting for HTTPS to be allowed in their tailnet.
    reach_stop: AtomicBool,
}

fn state(app: &AppHandle) -> std::sync::MutexGuard<'_, Inner> {
    app.state::<LocalServer>().inner().inner.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn cancelled(app: &AppHandle) -> bool {
    app.state::<LocalServer>().cancel.load(SeqCst)
}

pub fn setting_up(app: &AppHandle) -> bool {
    state(app).setting_up.is_some()
}

pub fn folder(app: &AppHandle) -> Option<Folder> {
    app.path().home_dir().ok().map(|h| Folder(h.join(FOLDER)))
}

/// The app's copy of the server's files (its resources); None in a build without them.
fn bundle(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?;
    (dir.join("server").join("native.js").is_file() && dir.join("web").is_dir()).then_some(dir)
}

/// The runner binary the app ships, which runs the server as Bun (next to the app's own program).
pub fn runner_binary() -> Option<PathBuf> {
    let path = std::env::current_exe().ok()?.parent()?.join(format!("agentes-runner{}", std::env::consts::EXE_SUFFIX));
    path.is_file().then_some(path)
}

fn here_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(HERE_FILE))
}

fn save_here(app: &AppHandle, here: &HereFile) {
    let Some(path) = here_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(here) {
        let _ = fs::write(path, text);
    }
}

/// Whether the app runs the server here.
pub fn runs(app: &AppHandle) -> bool {
    let here = state(app).here.clone();
    here.run && folder(app).is_some_and(|f| installed(&f) == Installed::App)
}

/// The server here's loopback address (where its host homes point, `host_sync.rs`), while the app runs it.
pub fn loopback(app: &AppHandle) -> Option<String> {
    if !runs(app) {
        return None;
    }
    port_of(&folder(app)?).map(loopback_url)
}

/// Its loopback address while its own child answers there: its host homes run only then (`Runners::rescan`),
/// so their tokens never reach whatever listens on the port while it is down.
pub fn answering_loopback(app: &AppHandle) -> Option<String> {
    is_running(app).then(|| loopback(app)).flatten()
}

/// Its address for people: `PUBLIC_URL` (the Tailscale one with reach on), else the loopback one.
pub fn public_url(app: &AppHandle) -> Option<String> {
    let folder = folder(app)?;
    env_get(&read_env(&folder), "PUBLIC_URL")
        .and_then(|u| crate::servers::origin_of(&u))
        .or_else(|| port_of(&folder).map(loopback_url))
}

/// Whether `origin` is the server here, at either of its addresses.
pub fn is_here(app: &AppHandle, origin: &str) -> bool {
    runs(app) && (loopback(app).as_deref() == Some(origin) || public_url(app).as_deref() == Some(origin))
}

/// The server here answers now, as the app's own child (host syncs, the owner key and the main window's bridge
/// wait for it).
pub fn is_running(app: &AppHandle) -> bool {
    phase(app) == Phase::Running
}

/// Whether `origin`, one of the server here's addresses, leads to the app's own child now: it runs, and at its
/// Tailscale address Tailscale shares it again (until then that address may still lead to its old port).
/// Waits up to `wait` while either is on its way (a page that loaded as it came up asks at once).
pub fn answers_within(app: &AppHandle, origin: &str, wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    let via_tailnet = origin.starts_with("https://");
    loop {
        match phase(app) {
            Phase::Running if !via_tailnet || state(app).served => return true,
            Phase::Running | Phase::Starting | Phase::Updating | Phase::Restarting if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(100))
            }
            _ => return false,
        }
    }
}

pub fn phase(app: &AppHandle) -> Phase {
    if runs(app) {
        state(app).phase.unwrap_or(Phase::Stopped)
    } else {
        Phase::Off
    }
}

/// A page of the server here at its loopback address (its homes' links: they keep that address) opens at its
/// address for people, the one the window signs in at.
pub fn page_for_people(app: &AppHandle, url: Url) -> Url {
    let (Some(local), Some(public)) = (loopback(app), public_url(app)) else { return url };
    moved_page(url, &local, &public)
}

fn moved_page(url: Url, from: &str, to: &str) -> Url {
    if from == to || url.origin().ascii_serialization() != from {
        return url;
    }
    let mut rest = url.path().to_string();
    if let Some(q) = url.query() {
        rest.push('?');
        rest.push_str(q);
    }
    if let Some(f) = url.fragment() {
        rest.push('#');
        rest.push_str(f);
    }
    format!("{to}{rest}").parse().unwrap_or(url)
}

/// The admin page the last `tailscale serve` named for turning HTTPS on.
pub fn https_admin_url(app: &AppHandle) -> Option<String> {
    state(app).https_url.clone()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// This build carries the server (Mac and Linux builds do).
    bundled: bool,
    installed: Installed,
    run: bool,
    owner: bool,
    phase: Phase,
    url: Option<String>,
    public_url: Option<String>,
    reach: bool,
    usage: bool,
    version: Option<String>,
    dir: String,
    /// The person's name on this computer, for the owner's name (the welcome window only).
    system_name: Option<String>,
    /// A terminal install's server runs now: `server.json` names a live server of this folder (the welcome
    /// window only).
    serving: bool,
    /// A terminal install still waiting for its owner, and running: its claim (the welcome window only).
    claim: Option<String>,
    back_to: Option<String>,
    /// Stopped by the person to stay stopped (Stop): until Start, or until `held_until`.
    held: bool,
    /// When a stop "for an hour" ends and it starts again by itself (Unix milliseconds).
    held_until: Option<u64>,
    /// Reach is on but Tailscale isn't connected on this computer: nobody else can reach it now.
    tailnet_down: bool,
}

fn system_name() -> Option<String> {
    #[cfg(target_os = "macos")]
    let out = Command::new("id").arg("-F").output().ok()?;
    #[cfg(all(unix, not(target_os = "macos")))]
    let out = {
        let user = std::env::var("USER").ok()?;
        Command::new("getent").args(["passwd", &user]).output().ok()?
    };
    #[cfg(unix)]
    {
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        #[cfg(not(target_os = "macos"))]
        let text = text.split(':').nth(4).unwrap_or("").split(',').next().unwrap_or("").trim().to_string();
        (!text.is_empty() && text.chars().count() <= 100).then_some(text)
    }
    // Windows hands out no full name without a slow query: the person types it.
    #[cfg(not(unix))]
    {
        None
    }
}

pub fn status(app: &AppHandle, welcome: bool) -> Status {
    let (here, phase, back_to, tailnet_down) = {
        let inner = state(app);
        (inner.here.clone(), inner.phase, inner.back_to.clone(), inner.tailnet_down)
    };
    let folder = folder(app);
    let env = folder.as_ref().map(read_env).unwrap_or_default();
    let installed = folder.as_ref().map(installed).unwrap_or(Installed::None);
    let run = here.run && installed == Installed::App;
    let port = env_get(&env, "PORT").and_then(|p| p.parse::<u16>().ok());
    let public = env_get(&env, "PUBLIC_URL").and_then(|u| crate::servers::origin_of(&u));
    let reach = public.as_deref().is_some_and(|p| p.starts_with("https://"));
    let ready: Option<Value> = folder
        .as_ref()
        .and_then(|f| fs::read_to_string(f.ready()).ok())
        .and_then(|t| serde_json::from_str(&t).ok());
    let serving = welcome
        && installed == Installed::Terminal
        && folder.as_ref().is_some_and(|f| folder_server(f, &f.ready()).is_some());
    // Only while its own server holds the port: anything else listening there must never see the claim.
    let claim = folder
        .as_ref()
        .filter(|_| serving)
        .and_then(|f| fs::read_to_string(f.claim()).ok())
        .map(|c| c.trim().to_string())
        .filter(|c| crate::servers::page_path(&format!("/owner#claim={c}")));
    Status {
        bundled: bundle(app).is_some() && runner_binary().is_some(),
        installed,
        run,
        owner: here.owner,
        phase: if run { phase.unwrap_or(Phase::Stopped) } else { Phase::Off },
        url: port.map(loopback_url).or_else(|| ready.as_ref().and_then(|r| r["url"].as_str().map(str::to_string))),
        reach,
        public_url: public,
        usage: telemetry_on(env_get(&env, "TELEMETRY").as_deref()),
        version: ready
            .as_ref()
            .and_then(|r| r["version"].as_str().map(str::to_string))
            .or_else(|| folder.as_ref().and_then(current_version)),
        dir: folder.map(|f| f.0.to_string_lossy().into_owned()).unwrap_or_default(),
        system_name: (welcome && installed != Installed::App).then(system_name).flatten(),
        serving,
        claim,
        back_to,
        held: run && here.hold.is_some(),
        held_until: here.hold.and_then(|h| h.until).map(|t| t * 1000),
        tailnet_down: tailnet_down && reach,
    }
}

fn emit_status(app: &AppHandle) {
    let _ = app.emit(STATUS_EVENT, status(app, false));
    crate::tray::refresh(app);
}

fn set_phase(app: &AppHandle, phase: Phase) {
    state(app).phase = Some(phase);
    emit_status(app);
}

/// It can't start: every way there says so the same, on screen and with the system's notification (not only after
/// the tries ran out), since nobody can use it meanwhile.
fn failed(app: &AppHandle) {
    set_phase(app, Phase::Failing);
    notify(app, "hereFailing", "hereFailingBody", None);
    // A page of it already on screen gets the cover back, with Try again and Copy details.
    crate::cover::over_server_here(app);
}

fn note(app: &AppHandle, line: String) {
    let mut inner = state(app);
    if inner.lines.len() >= STDERR_LINES {
        inner.lines.pop_front();
    }
    inner.lines.push_back(line);
}

fn launch_of(app: &AppHandle) -> Option<Launch> {
    let folder = folder(app)?;
    Some(Launch { bun: runner_binary()?, version: current_version(&folder)?, folder })
}

/// Starts the server (copying a new version's files first) unless it runs; returns at once.
pub fn start(app: &AppHandle) {
    {
        let mut inner = state(app);
        if inner.pid.is_some() || inner.launching {
            return;
        }
        inner.launching = true;
        inner.on_purpose = false;
        inner.failed = 0;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let result = start_now(&app);
        state(&app).launching = false;
        if let Err(err) = result {
            note(&app, format!("start: {err}"));
            failed(&app);
        }
    });
}

fn start_now(app: &AppHandle) -> Result<(), String> {
    let folder = folder(app).ok_or("no home folder")?;
    let version = app.package_info().version.to_string();
    let current = current_version(&folder);
    // This version's server didn't start before, and it went back: it stays back until the next version.
    let skipped = state(app).here.skip.as_deref() == Some(version.as_str());
    if let Some(back) = current.clone().filter(|c| skipped && *c != version && folder.entry(c).is_file()) {
        state(app).back_to = Some(back);
        set_phase(app, Phase::Starting);
        stop_leftover(app, &folder);
        return spawn(app, Phase::Starting);
    }
    // From the first moment (copying a new version's files takes a little while).
    let updating = current.is_some_and(|v| v != version);
    set_phase(app, if updating { Phase::Updating } else { Phase::Starting });
    // Before the database is copied aside: never while a server runs on it.
    stop_leftover(app, &folder);
    let bundle = bundle(app).ok_or("this build doesn't carry the server")?;
    let copied = install_version(&folder, &bundle, &version).map_err(|e| e.to_string())?;
    let saved = state(app).here.updating_from.clone();
    let from = update_from_after(&copied, saved.as_deref(), &version, |v| folder.entry(v).is_file());
    set_update_from(app, from.clone());
    spawn(app, if from.is_some() { Phase::Updating } else { Phase::Starting })
}

/// The version this start updates from: a new copy's previous one, or, when this version's copy was already in place,
/// the update a quit cut short (its previous copy still there), so its database still moves or goes back.
pub fn update_from_after(copied: &Copied, saved: Option<&str>, version: &str, has_copy: impl Fn(&str) -> bool) -> Option<String> {
    match copied {
        Copied::Update { from } => Some(from.clone()),
        Copied::Same => saved.filter(|f| *f != version && has_copy(f)).map(str::to_string),
        Copied::First => None,
    }
}

/// The update under way, in memory and in the app's record (None once it answered or went back).
fn set_update_from(app: &AppHandle, from: Option<String>) {
    let here = {
        let mut inner = state(app);
        inner.update_from = from.clone();
        if inner.here.updating_from == from {
            return;
        }
        inner.here.updating_from = from;
        inner.here.clone()
    };
    save_here(app, &here);
}

/// The folder's port, or, when another program listens there now, the next free one (its address moves with
/// it): the server never starts behind someone else's answers.
fn port_here(app: &AppHandle, folder: &Folder) -> Result<u16, String> {
    let port = port_of(folder).ok_or("no PORT in .env")?;
    if port_free(port) {
        return Ok(port);
    }
    note(app, format!("port {port} is taken on this computer: moving to another"));
    move_port(app, folder, port)
}

fn spawn(app: &AppHandle, phase: Phase) -> Result<(), String> {
    let launch = launch_of(app).ok_or("the server's files aren't in place")?;
    let port = port_here(app, &launch.folder)?;
    let mut child = launch.spawn().map_err(|e| e.to_string())?;
    let generation = {
        let mut inner = state(app);
        inner.generation += 1;
        inner.pid = Some(child.id());
        inner.answered = false;
        inner.served = false;
        if inner.failed == 0 {
            inner.trying_since = Some(Instant::now());
        }
        inner.phase = Some(phase);
        inner.generation
    };
    emit_status(app);
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                note(&app, line.chars().take(500).collect());
            }
        });
    }
    let app = app.clone();
    let folder = launch.folder;
    std::thread::spawn(move || watch(&app, child, generation, port, &folder));
    Ok(())
}

/// Waits for the child to answer, then for it to stop, and decides what comes next.
fn watch(app: &AppHandle, mut child: Child, generation: u64, port: u16, folder: &Folder) {
    // Starts that keep stopping before they answer share one wait (3 minutes in all, not each).
    let since = state(app).trying_since.unwrap_or_else(Instant::now);
    let pid = child.id();
    let current = |app: &AppHandle| state(app).generation == generation;
    let mut timed_out = false;
    let code = loop {
        if let Ok(Some(status)) = child.try_wait() {
            break status.code();
        }
        if !state(app).answered {
            // Its own answer only: whatever else holds the port answers health too.
            if ready_pid(folder) == Some(pid) && healthy(port) {
                {
                    let mut inner = state(app);
                    inner.answered = true;
                    inner.failed = 0;
                }
                set_update_from(app, None);
                set_phase(app, Phase::Running);
                keep_awake(app, pid);
                crate::host_sync::trigger(app);
                crate::cover::server_here_ready(app);
                let app = app.clone();
                std::thread::spawn(move || ensure_served(&app));
            } else if since.elapsed() > ANSWER_WITHIN && current(app) {
                note(app, "it didn't answer within 3 minutes".into());
                timed_out = true;
                let _ = child.kill();
            }
        }
        std::thread::sleep(Duration::from_millis(if state(app).answered { 1000 } else { 300 }));
    };
    let _ = child.wait();
    forget_pipe(pid);
    if !current(app) {
        return;
    }
    let (next, answered) = {
        let mut inner = state(app);
        inner.pid = None;
        inner.phase = Some(Phase::Stopped);
        let answered = inner.answered;
        if !answered && !inner.on_purpose {
            inner.failed = failed_starts(inner.failed, timed_out);
        }
        if !inner.on_purpose {
            let now = Instant::now();
            inner.stops.push_back(now);
            while inner.stops.front().is_some_and(|t| now.duration_since(*t) > STOPS_WINDOW) {
                inner.stops.pop_front();
            }
        }
        let next = next_after(inner.on_purpose, code, answered, inner.failed, inner.update_from.as_deref());
        // Starting again by itself is never "stopped": nobody has to start it.
        if !matches!(next, Next::Nothing | Next::GiveUp) {
            inner.phase = Some(Phase::Restarting);
        }
        (next, answered)
    };
    if answered {
        // Its host homes pause until it answers again (the next sync starts them).
        let app = app.clone();
        std::thread::spawn(move || app.state::<crate::runners::Runners>().rescan(&app));
    }
    if let Some(code) = code {
        note(app, format!("agentes-server exited with {code}"));
    }
    match next {
        Next::Nothing => set_phase(app, Phase::Stopped),
        Next::Restart(delay) => {
            set_phase(app, Phase::Restarting);
            // Refused because a server left from before still holds the folder: that one goes first.
            if code == Some(exit::LOCKED) {
                stop_leftover(app, folder);
            }
            if answered && state(app).stops.len() >= 3 {
                state(app).stops.clear();
                notify(app, "hereRestarted", "hereRestartedBody", None);
            }
            std::thread::sleep(delay);
            let wanted = {
                let inner = state(app);
                inner.generation == generation && !inner.on_purpose && inner.pid.is_none() && inner.here.run
            };
            if wanted {
                if let Err(err) = spawn(app, Phase::Starting) {
                    note(app, format!("restart: {err}"));
                    failed(app);
                }
            }
        }
        Next::Upgrade { from } => {
            if let Err(err) = upgrade(app, from.as_deref()) {
                note(app, format!("database upgrade: {err}"));
                failed(app);
            }
        }
        // Its port was taken meanwhile: the start moves to a free one.
        Next::NewPort => {
            if let Err(err) = spawn(app, Phase::Starting) {
                note(app, format!("port: {err}"));
                failed(app);
            }
        }
        Next::GoBack { to } => {
            let from = app.package_info().version.to_string();
            let back = go_back(folder, &from, &to).map_err(|e| e.to_string());
            let here = {
                let mut inner = state(app);
                inner.update_from = None;
                inner.here.updating_from = None;
                inner.failed = 0;
                if back.is_ok() {
                    inner.back_to = Some(to.clone());
                    inner.here.skip = Some(from.clone());
                }
                inner.here.clone()
            };
            save_here(app, &here);
            match back.and_then(|_| spawn(app, Phase::Starting)) {
                Ok(()) => notify(app, "hereBack", "hereBackBody", Some(&to)),
                Err(err) => {
                    note(app, format!("going back: {err}"));
                    failed(app);
                }
            }
        }
        Next::GiveUp => {
            failed(app);
        }
    }
}

/// The dump-and-restore upgrade across a Postgres major (ADR 0060 §2): the previous copy dumps, this one
/// restores (the old database moves to `backups/`); then it starts.
fn upgrade(app: &AppHandle, from: Option<&str>) -> Result<(), String> {
    let launch = launch_of(app).ok_or("the server's files aren't in place")?;
    let from = from.ok_or("no previous version to read the database with")?;
    let old = Launch { version: from.to_string(), ..launch.clone() };
    set_phase(app, Phase::Updating);
    make_private_dir(&launch.folder.backups()).map_err(|e| e.to_string())?;
    let dump = launch.folder.backups().join(format!("upgrade-{from}-{}.sql", stamp()));
    let out = dump.to_string_lossy().into_owned();
    // A database move is never cut short by a click.
    let ran = old.run(&["db", "dump", "--out", &out], MOVE_WAIT, &|| false).map_err(|e| e.to_string())?;
    if ran.code != Some(0) {
        return Err(format!("dump ended with {:?} ({:?}): {}", ran.code, ran.cut, ran.err.trim()));
    }
    let ran = launch.run(&["db", "restore", "--in", &out], MOVE_WAIT, &|| false).map_err(|e| e.to_string())?;
    if ran.code != Some(0) {
        return Err(format!("restore ended with {:?} ({:?}): {}", ran.code, ran.cut, ran.err.trim()));
    }
    let _ = fs::remove_file(&dump);
    // The copy took its own time: the upgraded start gets the whole wait.
    fresh_start(app);
    spawn(app, Phase::Updating)
}

/// Its port `old` is taken by something else: the next free one, and the address with it.
fn move_port(app: &AppHandle, folder: &Folder, old: u16) -> Result<u16, String> {
    let port = free_port().ok_or("no free port between 4310 and 4329")?;
    let reach = reached(app);
    let mut entries = vec![("PORT", port.to_string())];
    if !reach {
        entries.push(("PUBLIC_URL", loopback_url(port)));
    }
    write_env(folder, &entries).map_err(|e| e.to_string())?;
    if reach {
        // Its share still leads to the old port: it goes now, and comes back on the new one once the server
        // answers there (`ensure_served`).
        unserve_here(app);
    } else {
        crate::servers::replace(app, &loopback_url(old), &loopback_url(port));
        crate::main_window::follow_move(app, &loopback_url(old));
    }
    Ok(port)
}

/// Reach is on: its address for people is the Tailscale one.
fn reached(app: &AppHandle) -> bool {
    public_url(app).is_some_and(|u| u.starts_with("https://"))
}

/// With reach on, Tailscale shares the server while it runs here: again after every start, and every minute
/// until that worked (`host_sync.rs`). It stops sharing whenever the server stops here (`unserve_here`), so
/// the tailnet address never leads to whatever listens on the port meanwhile.
pub fn ensure_served(app: &AppHandle) {
    let Some(url) = public_url(app).filter(|u| u.starts_with("https://")) else { return };
    if !is_running(app) || state(app).served {
        return;
    }
    let Some(folder) = folder(app) else { return };
    let Some(port) = port_of(&folder) else { return };
    // Nobody is there to allow HTTPS now: asked for it, it stops (reach turned on again asks the person).
    let asked = std::cell::Cell::new(false);
    let shared = crate::tailscale::serve(port, &mut |_| asked.set(true), &|| asked.get());
    let down = matches!(shared, Err(crate::tailscale::ServeError::NotConnected { .. }));
    if state(app).tailnet_down != down {
        state(app).tailnet_down = down;
        emit_status(app);
    }
    let Ok(now) = shared else { return };
    if !is_running(app) {
        return;
    }
    if now != url {
        // Tailscale shares it at another address now (this device was renamed, or another share took 443): it
        // moves there instead of sharing at an address nobody can open. Not while a reach change or a setup runs.
        let server = app.state::<LocalServer>();
        let Ok(_busy) = server.busy.try_lock() else { return };
        note(app, format!("Tailscale shares it at {now}, not {url}: moving there"));
        let was = crate::workspaces::window_user(app, &url);
        let showing = crate::servers::current(app).is_some_and(|c| c.origin().ascii_serialization() == url);
        if move_address(app, &folder, Some(&url), &now).is_ok() {
            emit_status(app);
            if showing {
                let _ = follow_window(app, &folder, port, &now, was);
            }
        }
        return;
    }
    state(app).served = true;
    crate::cover::server_here_ready(app);
}

/// Tailscale's state, read again every minute while reach is on and the server runs (`host_sync.rs`): Tailscale
/// turned off on this computer means nobody else reaches it, and its line says so; back on, it is shared again.
pub fn check_tailnet(app: &AppHandle) {
    if !reached(app) || !is_running(app) {
        return;
    }
    let down = !matches!(crate::tailscale::tailnet(), crate::tailscale::Tailnet::On { .. });
    let changed = {
        let mut inner = state(app);
        let changed = inner.tailnet_down != down;
        inner.tailnet_down = down;
        if down {
            // Shared again once it is back (`ensure_served`).
            inner.served = false;
        }
        changed
    };
    if changed {
        emit_status(app);
    }
}

/// With reach on, people reach the server here from their phones and computers: this Mac stays awake while it
/// runs (`caffeinate -i -w <the server>`, which ends by itself when the server does). Other systems: nothing.
fn keep_awake(app: &AppHandle, server_pid: u32) {
    if !cfg!(target_os = "macos") || !reached(app) {
        return;
    }
    let_sleep(app);
    let spawned = Command::new("/usr/bin/caffeinate")
        .args(["-i", "-w", &server_pid.to_string()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    if let Ok(mut child) = spawned {
        let id = child.id();
        state(app).awake = Some(id);
        // Reaped when it ends (with the server, or `let_sleep`), and forgotten then: its pid is never signalled
        // again once another process may have it.
        let app = app.clone();
        std::thread::spawn(move || {
            let _ = child.wait();
            let mut inner = state(&app);
            if inner.awake == Some(id) {
                inner.awake = None;
            }
        });
    }
}

/// This Mac may sleep again (reach turned off; the server stopping ends `caffeinate` by itself).
fn let_sleep(app: &AppHandle) {
    let Some(pid) = state(app).awake.take() else { return };
    // A function per platform: an attribute on an `if` statement isn't stable Rust.
    #[cfg(unix)]
    fn end(pid: u32) {
        if pid_alive(pid) {
            stop_pid(pid, Duration::from_millis(500), || !pid_alive(pid));
        }
    }
    #[cfg(not(unix))]
    fn end(_pid: u32) {}
    end(pid);
}

/// Tailscale stops sharing the server here (it stopped here, or the app quits).
fn unserve_here(app: &AppHandle) {
    if let Some(url) = public_url(app).filter(|u| u.starts_with("https://")) {
        crate::tailscale::unserve(&url);
    }
    state(app).served = false;
}

/// Stops it and waits (at most the grace period, then it is killed). `forget`: no longer started with the app.
pub fn stop(app: &AppHandle, forget: bool) {
    let (pid, here) = {
        let mut inner = state(app);
        inner.on_purpose = true;
        if forget {
            inner.here.run = false;
            inner.here.hold = None;
        }
        (inner.pid, inner.here.clone())
    };
    if forget {
        save_here(app, &here);
    }
    if let Some(pid) = pid {
        stop_pid(pid, STOP_GRACE, || state(app).pid.is_none());
        // The watcher marks it stopped; this covers a kill it never saw.
        let deadline = Instant::now() + Duration::from_secs(2);
        while state(app).pid.is_some() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    emit_status(app);
}

/// Waits for a start to answer, or to give up, or for Cancel (and quitting); the phase it ended in.
fn wait_running(app: &AppHandle) -> Phase {
    let deadline = Instant::now() + ANSWER_WITHIN + Duration::from_secs(30);
    loop {
        let phase = state(app).phase.unwrap_or(Phase::Stopped);
        if matches!(phase, Phase::Running | Phase::Failing) || Instant::now() > deadline || cancelled(app) {
            return phase;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// A start of the app's own doing (not after an exit): a new series of tries.
fn fresh_start(app: &AppHandle) {
    let mut inner = state(app);
    inner.on_purpose = false;
    inner.failed = 0;
}

fn restart(app: &AppHandle) -> Result<(), String> {
    stop(app, false);
    fresh_start(app);
    spawn(app, Phase::Starting)?;
    match wait_running(app) {
        Phase::Running => Ok(()),
        _ => Err("start".into()),
    }
}

/// At the app's start: what it knew, and the server started when the app runs it.
pub fn load(app: &AppHandle) {
    let here: HereFile = here_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let hold = here.hold;
    state(app).here = here;
    if !runs(app) {
        return;
    }
    match hold.map(|h| hold_left(h.until, now_secs())) {
        Some(HoldLeft::UntilStart) => emit_status(app),
        Some(HoldLeft::For(_)) => release_at(app, hold.and_then(|h| h.until).unwrap_or_default()),
        Some(HoldLeft::Over) | None => {
            if hold.is_some() {
                set_hold(app, None);
            }
            start(app);
        }
    }
}

fn set_hold(app: &AppHandle, hold: Option<Hold>) {
    let here = {
        let mut inner = state(app);
        inner.here.hold = hold;
        inner.here.clone()
    };
    save_here(app, &here);
    emit_status(app);
}

/// Stop, by the person: it stays stopped until Start (`minutes` None), or starts again by itself after `minutes`.
/// Tailscale stops sharing it and the agents of its workspaces stop working here meanwhile, as with any stop.
pub fn hold_stopped(app: &AppHandle, minutes: Option<u64>) {
    let until = minutes.map(|m| now_secs() + m * 60);
    stop_by_hand(app, false);
    set_hold(app, Some(Hold { until }));
    // A page of it on screen: the cover says it is stopped, until when, and offers Start now or another server.
    crate::cover::over_server_here(app);
    if let Some(until) = until {
        release_at(app, until);
    }
}

/// Start, by the person (the popover, Preferences, the menus): any hold ends.
pub fn start_by_hand(app: &AppHandle) {
    if state(app).here.hold.is_some() {
        set_hold(app, None);
    }
    start(app);
}

/// At `until`, a stop "for an hour" ends: it starts again, unless the person changed it meanwhile (started it,
/// stopped it again, stopped running it here).
fn release_at(app: &AppHandle, until: u64) {
    emit_status(app);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(until.saturating_sub(now_secs())));
        let still = state(&app).here.hold == Some(Hold { until: Some(until) });
        if still && runs(&app) {
            set_hold(&app, None);
            start(&app);
        }
    });
}

/// The person stopped it (Stop, "Stop running it here…"): Tailscale stops sharing it too, and the agents of its
/// organizations stop working here until it runs again (their homes stay).
pub fn stop_by_hand(app: &AppHandle, forget: bool) {
    stop(app, forget);
    unserve_here(app);
    app.state::<crate::runners::Runners>().rescan(app);
}

/// Quitting, logging out, an update: the server finishes and stops (before the app goes), and a setup under way
/// stops waiting.
pub fn shutdown(app: &AppHandle) {
    app.state::<LocalServer>().cancel.store(true, SeqCst);
    let pid = {
        let mut inner = state(app);
        inner.on_purpose = true;
        inner.pid
    };
    if let Some(pid) = pid {
        stop_pid(pid, STOP_GRACE, || state(app).pid.is_none());
    }
    if runs(app) {
        unserve_here(app);
    }
}

/// The main window on the server here, signed in as its owner (a one-time sign-in the window trades itself).
fn open_signed_in(app: &AppHandle, origin: &str, token: &str) -> Result<(), String> {
    crate::servers::choose(app, origin);
    let url: Url = format!("{origin}/desktop/handover#token={token}").parse().map_err(|_| "not a URL")?;
    crate::main_window::show_url(app, url)
}

/// The site's sign-in asked to sign the owner in ("Continue on this Mac", `this_mac` `signIn`).
pub fn sign_in_window(app: &AppHandle, origin: &str) -> Result<(), String> {
    if !answers_within(app, origin, Duration::ZERO) {
        return Err("not running".into());
    }
    let folder = folder(app).ok_or("no folder")?;
    let port = port_of(&folder).ok_or("no port")?;
    let token = owner_sign_in(&folder, port, None).map_err(|s| format!("sign-in refused ({s})"))?;
    open_signed_in(app, origin, &token)
}

fn notify(app: &AppHandle, title: &str, body: &str, version: Option<&str>) {
    use tauri_plugin_notification::NotificationExt;
    let labels = crate::menus::labels(app);
    let Some(title) = labels.get(title) else { return };
    let body = labels.get(body).cloned().unwrap_or_default();
    let fill = |s: &str| s.replace("{version}", version.unwrap_or(""));
    *NOTICE_AT.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    let _ = app.notification().builder().title(fill(title)).body(fill(&body)).show();
}

/// When the server here last told something with the system's notification.
static NOTICE_AT: Mutex<Option<Instant>> = Mutex::new(None);
/// A click on that notification brings the app forward within this long: the popover opens, where its banner
/// says what happened and how to fix it.
const NOTICE_OPENS_FOR: Duration = Duration::from_secs(30);

/// The app came forward (its Dock icon, its window): true once, within `NOTICE_OPENS_FOR` of a notification of the
/// server here, and the caller opens the popover.
pub fn take_notice_click() -> bool {
    NOTICE_AT.lock().unwrap_or_else(|e| e.into_inner()).take().is_some_and(|at| at.elapsed() <= NOTICE_OPENS_FOR)
}

// ───────────────────────────── setting it up ─────────────────────────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StepEvent {
    step: &'static str,
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<crate::tailscale::ServeError>,
}

fn step(app: &AppHandle, step: &'static str, state: &'static str) {
    say_step(app, StepEvent { step, state, reason: None });
}

/// A step's change on screen, and in Copy details' timeline.
fn say_step(app: &AppHandle, event: StepEvent) {
    let secs = state(app).setting_up.map_or(0.0, |since| since.elapsed().as_secs_f64());
    note(app, format!("setup {secs:.1} s: {} {}", event.step, event.state));
    let _ = app.emit_to("welcome", STEP_EVENT, event);
}

/// The setup's way out of a step: "cancelled" (no step event) after Cancel, else the step failed, said on screen
/// and why in Copy details.
fn ended(app: &AppHandle, name: &'static str, why: String) -> String {
    if cancelled(app) {
        return "cancelled".into();
    }
    note(app, why);
    step(app, name, "failed");
    name.to_string()
}

fn go_on(app: &AppHandle) -> Result<(), String> {
    if cancelled(app) {
        Err("cancelled".into())
    } else {
        Ok(())
    }
}

/// Makes the folder and the database, starts the server, makes the owner, makes this computer the agents'
/// computer, turns reach on when asked, then opens the main window there, signed in. Each step says when it starts
/// and ends; reach failing never stops the rest. Err: the step that failed, or "cancelled". Nothing of it is kept
/// (`local-server.json`, the mark's removal, Open at login) until every step is done: `set_up` undoes the rest.
fn install(app: &AppHandle, choice: &Choice) -> Result<(), String> {
    let server = app.state::<LocalServer>();
    let _busy = server.busy.lock().unwrap_or_else(|e| e.into_inner());
    let fail = |name: &'static str, why: String| ended(app, name, why);
    go_on(app)?;
    step(app, "database", "active");
    let folder = folder(app).ok_or_else(|| fail("database", "no home folder".into()))?;
    if installed(&folder) == Installed::Terminal {
        return Err(fail("database", "a server installed from the terminal uses this folder".into()));
    }
    let version = app.package_info().version.to_string();
    let bundle = bundle(app).ok_or_else(|| fail("database", "this build doesn't carry the server".into()))?;
    let bun = runner_binary().ok_or_else(|| fail("database", "the app's runner binary isn't there".into()))?;
    // A setup that never finished (a crash, a power cut) left its database: it goes first.
    discard_unowned(&folder);
    let first = prepare(&folder, choice.usage, free_port)
        .and_then(|_| install_version(&folder, &bundle, &version))
        .map_err(|e| fail("database", format!("setting up {}: {e}", folder.0.display())))?;
    if first == Copied::First || !folder.db().is_dir() {
        if !folder.db().is_dir() {
            write_private(&folder.pending(), b"", true)
                .map_err(|e| fail("database", format!("the setup's mark: {e}")))?;
        }
        let launch = Launch { bun, folder: folder.clone(), version: version.clone() };
        let ran = launch
            .run(&["migrate"], ANSWER_WITHIN, &|| cancelled(app))
            .map_err(|e| fail("database", format!("migrate: {e}")))?;
        if ran.code != Some(0) {
            return Err(fail("database", format!("migrate ended with {:?} ({:?}): {}", ran.code, ran.cut, ran.err.trim())));
        }
    }
    // Reach left off this time: its address is this computer's again before it starts.
    if !choice.reach && reached(app) {
        address_here(app, &folder).map_err(|e| fail("database", format!("address: {e}")))?;
    }
    go_on(app)?;
    step(app, "database", "done");

    {
        let mut inner = state(app);
        inner.here.run = true;
        inner.here.hold = None;
        inner.failed = 0;
        inner.back_to = None;
        inner.on_purpose = false;
    }
    let port = start_with_owner(app, &folder, choice, &fail)?;
    go_on(app)?;
    step(app, "account", "done");

    step(app, "computer", "active");
    crate::host_sync::sync_now(app, &[]);
    go_on(app)?;
    step(app, "computer", "done");

    if choice.reach {
        step(app, "reach", "active");
        let reach = reach_on(app);
        go_on(app)?;
        match reach {
            Ok(_) => step(app, "reach", "done"),
            Err(reason) => say_step(app, StepEvent { step: "reach", state: "warn", reason: Some(reason) }),
        }
    }

    // Every step is done: it is kept, and nothing from here on undoes it.
    let _ = fs::remove_file(folder.pending());
    let here = state(app).here.clone();
    save_here(app, &here);
    {
        use tauri_plugin_autostart::ManagerExt;
        let _ = app.autolaunch().enable();
    }
    emit_status(app);
    // The main window opens signed in, or else on the server's sign-in page, whose "Continue on this Mac" signs the
    // owner in: never a setup that ends in an error with every step done.
    if let Some(origin) = public_url(app) {
        let signed_in = owner_sign_in(&folder, port, None)
            .map_err(|status| format!("the owner's sign-in: the server answered {status}"))
            .and_then(|token| open_signed_in(app, &origin, &token));
        if let Err(why) = signed_in {
            note(app, why);
            crate::servers::choose(app, &origin);
            if let Ok(page) = origin.parse::<Url>() {
                let _ = crate::main_window::show_url(app, page);
            }
        }
    }
    Ok(())
}

/// The setup's start and account steps: the server answers as the app's own child, then its owner exists (kept
/// in memory until the setup is done). Its port.
fn start_with_owner(
    app: &AppHandle,
    folder: &Folder,
    choice: &Choice,
    fail: &dyn Fn(&'static str, String) -> String,
) -> Result<u16, String> {
    step(app, "start", "active");
    if state(app).pid.is_none() {
        stop_leftover(app, folder);
        spawn(app, Phase::Starting).map_err(|e| fail("start", format!("start: {e}")))?;
    }
    if wait_running(app) != Phase::Running {
        return Err(fail("start", "it didn't answer".into()));
    }
    go_on(app)?;
    step(app, "start", "done");

    step(app, "account", "active");
    let port = port_of(folder).ok_or_else(|| fail("account", "no PORT in .env".into()))?;
    let who = choice.name.as_deref().zip(choice.email.as_deref());
    owner_sign_in(folder, port, who)
        .map_err(|status| fail("account", format!("the owner's account: the server answered {status}")))?;
    state(app).here.owner = true;
    Ok(port)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReachStage<'a> {
    /// `sharing` (Tailscale), `approve` (HTTPS to allow at `url`), `restarting` (at the new address), `signingIn`.
    stage: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<&'a str>,
}

fn reach_stage(app: &AppHandle, stage: &'static str, url: Option<&str>) {
    let _ = app.emit(REACH_EVENT, ReachStage { stage, url });
}

/// Reach on: Tailscale shares the server, `PUBLIC_URL` becomes that address and the server starts again
/// there; the server list follows. The address, or why it didn't work. Each stage is said as it starts
/// (`REACH_EVENT`), and Tailscale's page for allowing HTTPS as soon as it names it.
fn reach_on(app: &AppHandle) -> Result<String, crate::tailscale::ServeError> {
    let folder = folder(app).ok_or(crate::tailscale::ServeError::Serve)?;
    let port = port_of(&folder).ok_or(crate::tailscale::ServeError::Serve)?;
    reach_stage(app, "sharing", None);
    let server = app.state::<LocalServer>();
    server.reach_stop.store(false, SeqCst);
    let mut asks = |url: &str| {
        state(app).https_url = Some(url.to_string());
        reach_stage(app, "approve", Some(url));
    };
    // "Stop waiting", or Cancel and quitting while it is set up.
    let stopped = || server.reach_stop.load(SeqCst) || cancelled(app);
    let url = crate::tailscale::serve(port, &mut asks, &stopped).inspect_err(|reason| {
        if let crate::tailscale::ServeError::Https { url } = reason {
            state(app).https_url.clone_from(url);
        }
    })?;
    let old = public_url(app);
    let pid = {
        let mut inner = state(app);
        inner.served = true;
        inner.tailnet_down = false;
        inner.pid
    };
    // Already its address (reach was on before): the server has it, no restart.
    if old.as_deref() == Some(url.as_str()) {
        if let Some(pid) = pid {
            keep_awake(app, pid);
        }
        return Ok(url);
    }
    reach_stage(app, "restarting", None);
    move_address(app, &folder, old.as_deref(), &url).map_err(|_| crate::tailscale::ServeError::Start)?;
    Ok(url)
}

/// Its address moves from `old` to `new` (its settings, the app's list) and it starts again there. When it doesn't
/// answer there, back to `old`, so the switch, the list and the window never point where it doesn't answer.
fn move_address(app: &AppHandle, folder: &Folder, old: Option<&str>, new: &str) -> Result<(), ()> {
    write_env(folder, &[("PUBLIC_URL", new.to_string())]).map_err(|_| ())?;
    if let Some(old) = old {
        crate::servers::replace(app, old, new);
    }
    if restart(app).is_ok() {
        return Ok(());
    }
    if let Some(old) = old {
        let _ = write_env(folder, &[("PUBLIC_URL", old.to_string())]);
        crate::servers::replace(app, new, old);
        if crate::servers::is_loopback(old) {
            crate::tailscale::unserve(new);
            state(app).served = false;
        }
        let _ = restart(app);
    }
    Err(())
}

/// Its address back to this computer's loopback, and Tailscale stops sharing it; the server reads it at start.
fn address_here(app: &AppHandle, folder: &Folder) -> Result<String, String> {
    let port = port_of(folder).ok_or("no port")?;
    let local = loopback_url(port);
    if let Some(old) = public_url(app).filter(|o| *o != local) {
        crate::tailscale::unserve(&old);
        crate::servers::replace(app, &old, &local);
    }
    {
        let mut inner = state(app);
        inner.served = false;
        inner.tailnet_down = false;
    }
    let_sleep(app);
    write_env(folder, &[("PUBLIC_URL", local.clone())]).map_err(|e| e.to_string())?;
    Ok(local)
}

fn reach_off(app: &AppHandle) -> Result<String, String> {
    let folder = folder(app).ok_or("no folder")?;
    let local = address_here(app, &folder)?;
    reach_stage(app, "restarting", None);
    restart(app)?;
    Ok(local)
}

/// "Back up now": the server stops for a moment while its database, files and settings are copied into
/// `backups/agentes-<date>.tar.gz` (the two newest stay), then starts again.
fn backup(app: &AppHandle) -> Result<String, String> {
    let folder = folder(app).ok_or("no folder")?;
    let was_running = state(app).pid.is_some();
    make_private_dir(&folder.backups()).map_err(|e| e.to_string())?;
    // Windows has no `date` program: the stamp then.
    #[cfg(unix)]
    let date = Command::new("date").arg("+%Y-%m-%d-%H%M%S").output().ok();
    #[cfg(not(unix))]
    let date: Option<std::process::Output> = None;
    let date = date.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|d| !d.is_empty());
    let name = format!("agentes-{}.tar.gz", date.unwrap_or_else(stamp));
    let out = folder.backups().join(&name);
    if was_running {
        stop(app, false);
    }
    let parts: Vec<&str> = ["db", "files", ".env"].into_iter().filter(|p| folder.0.join(p).exists()).collect();
    // Windows 10 and later carry `tar` too.
    let tar = crate::no_console(&mut Command::new("tar")).arg("-czf").arg(&out).arg("-C").arg(&folder.0).args(&parts).status();
    if was_running {
        fresh_start(app);
        let _ = spawn(app, Phase::Starting);
    }
    match tar {
        Ok(s) if s.success() => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&out, fs::Permissions::from_mode(0o600));
            }
            prune(&folder.backups(), "agentes-", 2, &[]);
            Ok(out.to_string_lossy().into_owned())
        }
        _ => Err("the copy didn't finish".into()),
    }
}

/// What "Copy details" copies: versions and state, what the server and the setup said, the end of its log. No
/// secret.
fn diagnostics(app: &AppHandle) -> String {
    let status = status(app, false);
    let lines = state(app).lines.iter().cloned().collect::<Vec<_>>().join("\n");
    let log = folder(app)
        .and_then(|f| fs::read(f.log()).ok())
        .map(|bytes| {
            let tail = &bytes[bytes.len().saturating_sub(16 * 1024)..];
            String::from_utf8_lossy(tail).into_owned()
        })
        .unwrap_or_default();
    format!(
        "agentes.chat app {} ({} {})\nserver here: {:?}, version {}, at {}, reach {}, usage statistics {}\n\n{}\n\n{}",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        status.phase,
        status.version.unwrap_or_default(),
        status.public_url.unwrap_or_default(),
        if status.reach { "on" } else { "off" },
        if status.usage { "on" } else { "off" },
        lines,
        log
    )
}

// ───────────────────────────── commands ─────────────────────────────

fn app_window(webview: &tauri::Webview, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&webview.label()) {
        Ok(())
    } else {
        Err("only the app's own windows ask this".into())
    }
}

/// The welcome, the popover, Preferences and the main window's cover.
const ANY: &[&str] = &["welcome", "popover", "prefs", "main-cover"];

#[tauri::command]
pub fn local_server_status(app: AppHandle, webview: tauri::Webview) -> Result<Status, String> {
    app_window(&webview, ANY)?;
    Ok(status(&app, webview.label() == "welcome"))
}

#[tauri::command]
pub async fn local_server_install(app: AppHandle, webview: tauri::Webview, choice: Choice) -> Result<(), String> {
    app_window(&webview, &["welcome"])?;
    let check = |s: &Option<String>, max: usize| s.as_ref().map_or(true, |v| !v.trim().is_empty() && v.chars().count() <= max);
    if !check(&choice.name, 100) || !check(&choice.email, 254) || choice.name.is_some() != choice.email.is_some() {
        return Err("bad name or email".into());
    }
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || set_up(&app2, &choice))
        .await
        .map_err(|e| e.to_string())?;
    emit_status(&app);
    result
}

/// `install`, and when it doesn't finish (Cancel, a failure, quitting) the computer as it was before Start: what
/// it started stops, Tailscale shares nothing it didn't, and the database it made goes. Its window closed meanwhile
/// (hidden): a notification when it failed, and opening the app brings the window back on that step; else the
/// window goes (`open_app` brings back any hidden one).
fn set_up(app: &AppHandle, choice: &Choice) -> Result<(), String> {
    let (was_run, reach_before) = (state(app).here.run, reached(app));
    let folder = folder(app).ok_or("no home folder")?;
    app.state::<LocalServer>().cancel.store(false, SeqCst);
    state(app).setting_up = Some(Instant::now());
    let result = install(app, choice);
    if result.is_err() {
        let pending = folder.pending().is_file();
        if pending {
            // Its owner lived in that database.
            state(app).here.owner = false;
        }
        if !was_run {
            // Stops it, unshares it and pauses its homes; `local-server.json` says it doesn't run here.
            stop_by_hand(app, true);
        }
        if !reach_before && reached(app) {
            let _ = address_here(app, &folder);
        }
        if pending {
            discard_unowned(&folder);
        }
    }
    if let Some(window) = app.get_webview_window("welcome").filter(|w| !w.is_visible().unwrap_or(true)) {
        match &result {
            Err(why) if why != "cancelled" => notify(app, "setupFailed", "setupFailedBody", None),
            // Done, or stopped from the popover or Preferences.
            _ => {
                let _ = window.destroy();
            }
        }
    }
    state(app).setting_up = None;
    app.state::<LocalServer>().cancel.store(false, SeqCst);
    result
}

/// Cancel while it is set up (Esc too): every wait of the setup ends, and `set_up` undoes it.
#[tauri::command]
pub fn local_server_cancel(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    app_window(&webview, &["welcome"])?;
    if setting_up(&app) {
        app.state::<LocalServer>().cancel.store(true, SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub fn local_server_start(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    app_window(&webview, ANY)?;
    if !folder(&app).is_some_and(|f| installed(&f) == Installed::App) {
        return Err("not set up here".into());
    }
    {
        let mut inner = state(&app);
        inner.here.run = true;
        // Start ends a stop the person asked to keep.
        inner.here.hold = None;
        inner.failed = 0;
        inner.back_to = None;
        let here = inner.here.clone();
        drop(inner);
        save_here(&app, &here);
    }
    start(&app);
    Ok(())
}

/// Stop: `forget` stops running it here; otherwise it stays stopped until Start, or for `minutes` (an hour, from
/// the popover's choices) and then starts again by itself. Either way it no longer starts when the app opens again.
#[tauri::command]
pub async fn local_server_stop(
    app: AppHandle,
    webview: tauri::Webview,
    forget: bool,
    minutes: Option<u64>,
) -> Result<(), String> {
    app_window(&webview, &["popover", "prefs"])?;
    // The popover's Stop during a setup is its Cancel.
    if setting_up(&app) {
        app.state::<LocalServer>().cancel.store(true, SeqCst);
    }
    // At most a day: a longer stop is "until Start".
    let minutes = minutes.filter(|m| (1..=24 * 60).contains(m));
    tauri::async_runtime::spawn_blocking(move || {
        if forget {
            stop_by_hand(&app, true);
        } else {
            hold_stopped(&app, minutes);
        }
        if forget {
            if let Some(origin) = public_url(&app) {
                crate::servers::remove(&app, &origin);
            }
            if let Some(local) = folder(&app).and_then(|f| port_of(&f)).map(loopback_url) {
                crate::servers::remove(&app, &local);
            }
            match crate::servers::current(&app) {
                Some(url) => {
                    let _ = crate::main_window::show_url(&app, url);
                }
                None => {
                    if let Some(window) = app.get_window(crate::main_window::LABEL) {
                        let _ = window.hide();
                    }
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn local_server_restart(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    app_window(&webview, &["popover", "prefs"])?;
    tauri::async_runtime::spawn_blocking(move || {
        let server = app.state::<LocalServer>();
        let _busy = server.busy.lock().unwrap_or_else(|e| e.into_inner());
        restart(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reach on or off; the main window follows the address, signed in. The reason when it didn't turn on.
#[tauri::command]
pub async fn local_server_reach(app: AppHandle, webview: tauri::Webview, on: bool) -> Result<Value, String> {
    app_window(&webview, &["prefs", "main-cover"])?;
    tauri::async_runtime::spawn_blocking(move || {
        let server = app.state::<LocalServer>();
        let _busy = server.busy.lock().unwrap_or_else(|e| e.into_inner());
        let shown = crate::servers::current(&app).map(|u| u.origin().ascii_serialization());
        let was_here = shown.as_deref().is_some_and(|o| is_here(&app, o));
        // Who the window was signed in as there, asked before its address changes (the old one may stop answering).
        let was = shown.as_deref().filter(|_| was_here).and_then(|o| crate::workspaces::window_user(&app, o));
        let result = if on {
            reach_on(&app).map_err(|reason| json!(reason))
        } else {
            // Turning it off asks nothing of Tailscale that can fail: what fails is the start at the address here.
            reach_off(&app).map_err(|_| json!(crate::tailscale::ServeError::Back))
        };
        emit_status(&app);
        let url = match result {
            Ok(url) => url,
            Err(reason) => return Ok(json!({ "ok": false, "problem": reason })),
        };
        if was_here {
            let folder = folder(&app).ok_or("no folder")?;
            let port = port_of(&folder).ok_or("no port")?;
            reach_stage(&app, "signingIn", None);
            follow_window(&app, &folder, port, &url, was)?;
        }
        Ok(json!({ "ok": true, "url": url }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "Stop waiting": reach stops waiting for HTTPS to be allowed in the tailnet (it ends as not turned on).
#[tauri::command]
pub fn local_server_reach_stop(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    app_window(&webview, &["welcome", "prefs"])?;
    app.state::<LocalServer>().reach_stop.store(true, SeqCst);
    Ok(())
}

/// The usage-statistics switch: `TELEMETRY` in `.env` (the server reads it at start, so it starts again).
#[tauri::command]
pub async fn local_server_usage(app: AppHandle, webview: tauri::Webview, on: bool) -> Result<(), String> {
    app_window(&webview, &["prefs"])?;
    tauri::async_runtime::spawn_blocking(move || {
        let server = app.state::<LocalServer>();
        let _busy = server.busy.lock().unwrap_or_else(|e| e.into_inner());
        let folder = folder(&app).ok_or("no folder")?;
        write_env(&folder, &[("TELEMETRY", if on { "on" } else { "off" }.to_string())]).map_err(|e| e.to_string())?;
        let running = state(&app).pid.is_some();
        let result = if running { restart(&app) } else { Ok(()) };
        emit_status(&app);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn local_server_backup(app: AppHandle, webview: tauri::Webview) -> Result<String, String> {
    app_window(&webview, &["prefs"])?;
    tauri::async_runtime::spawn_blocking(move || {
        let server = app.state::<LocalServer>();
        let _busy = server.busy.lock().unwrap_or_else(|e| e.into_inner());
        backup(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn local_server_diagnostics(app: AppHandle, webview: tauri::Webview) -> Result<String, String> {
    app_window(&webview, ANY)?;
    Ok(diagnostics(&app))
}

/// The popover: a host home's organization refused its token; the next sync asks for a new one.
#[tauri::command]
pub async fn local_server_sync(app: AppHandle, webview: tauri::Webview, rotate: Vec<String>) -> Result<(), String> {
    app_window(&webview, &["popover"])?;
    if rotate.len() > 50 || rotate.iter().any(|o| !crate::runners::valid_id(o)) {
        return Err("bad organization id".into());
    }
    tauri::async_runtime::spawn_blocking(move || crate::host_sync::sync_now(&app, &rotate))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn an_update_cut_short_is_still_an_update() {
        let has = |v: &str| v == "0.6.0";
        let update = Copied::Update { from: "0.6.0".into() };
        assert_eq!(update_from_after(&update, None, "0.7.0", has).as_deref(), Some("0.6.0"));
        // Quit before it answered: the copy is in place now, the record still names where it came from.
        assert_eq!(update_from_after(&Copied::Same, Some("0.6.0"), "0.7.0", has).as_deref(), Some("0.6.0"));
        // Nothing under way, that copy gone, or a record naming this very version: no update.
        assert_eq!(update_from_after(&Copied::Same, None, "0.7.0", has), None);
        assert_eq!(update_from_after(&Copied::Same, Some("0.5.0"), "0.7.0", has), None);
        assert_eq!(update_from_after(&Copied::Same, Some("0.7.0"), "0.7.0", |_| true), None);
        assert_eq!(update_from_after(&Copied::First, Some("0.6.0"), "0.7.0", has), None);
        let older: HereFile = serde_json::from_str(r#"{"run":true,"owner":true}"#).unwrap();
        assert_eq!(older.updating_from, None);
    }

    #[test]
    fn the_window_follows_as_the_owner_only_when_it_was() {
        assert!(sign_in_owner(Some("u-1"), Some("u-1")));
        assert!(!sign_in_owner(Some("u-2"), Some("u-1")), "a teammate signed in there gets the sign-in page");
        assert!(!sign_in_owner(None, Some("u-1")), "signed out there: the sign-in page");
        assert!(sign_in_owner(Some("u-1"), None), "an older server that doesn't say: as before");
    }

    #[test]
    fn a_kept_stop_and_its_end() {
        assert_eq!(hold_left(None, 1_000), HoldLeft::UntilStart);
        assert_eq!(hold_left(Some(1_060), 1_000), HoldLeft::For(60));
        // The hour ended while the app was closed: it starts as the app opens.
        assert_eq!(hold_left(Some(1_000), 1_000), HoldLeft::Over);
        assert_eq!(hold_left(Some(900), 1_000), HoldLeft::Over);
        // Saved and read back; a record from before holds existed reads as none.
        let here = HereFile { run: true, owner: true, hold: Some(Hold { until: Some(1_060) }), ..Default::default() };
        let back: HereFile = serde_json::from_str(&serde_json::to_string(&here).unwrap()).unwrap();
        assert_eq!(back.hold, Some(Hold { until: Some(1_060) }));
        let until_start: HereFile = serde_json::from_str(r#"{"run":true,"owner":true,"hold":{}}"#).unwrap();
        assert_eq!(until_start.hold, Some(Hold { until: None }));
        let older: HereFile = serde_json::from_str(r#"{"run":true,"owner":true}"#).unwrap();
        assert_eq!(older.hold, None);
    }

    /// A new temporary folder for one test.
    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("agentes-local-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn env_lines_as_the_server_reads_them() {
        let text = "# comment\nexport PORT=4311\nPUBLIC_URL='http://127.0.0.1:4311'\nNAME=\"a \\\"b\\\"\"\nX=1 # note\n";
        assert_eq!(env_get(text, "PORT").as_deref(), Some("4311"));
        assert_eq!(env_get(text, "PUBLIC_URL").as_deref(), Some("http://127.0.0.1:4311"));
        assert_eq!(env_get(text, "NAME").as_deref(), Some("a \"b\""));
        assert_eq!(env_get(text, "X").as_deref(), Some("1"));
        assert_eq!(env_get(text, "MISSING"), None);
        let next = env_set(text, &[("PORT", "4312".into()), ("TELEMETRY", "off".into())]);
        assert_eq!(
            next,
            "# comment\nPORT=4312\nPUBLIC_URL='http://127.0.0.1:4311'\nNAME=\"a \\\"b\\\"\"\nX=1 # note\nTELEMETRY=off\n"
        );
        assert_eq!(env_set("A=1\nA=2\n", &[("A", "3".into())]), "A=3\n");
        assert_eq!(env_value("a b"), "'a b'");
    }

    #[test]
    fn a_new_folder_gets_its_secrets_once() {
        let folder = Folder(temp("prepare").join(".agentes"));
        prepare(&folder, true, || Some(4317)).unwrap();
        let env = read_env(&folder);
        let key = fs::read_to_string(folder.owner_key()).unwrap();
        assert_eq!(env_get(&env, "OWNER_KEY_SHA256"), Some(sha256_hex(&key)));
        assert_eq!(env_get(&env, "PORT").as_deref(), Some("4317"));
        assert_eq!(env_get(&env, "PUBLIC_URL").as_deref(), Some("http://127.0.0.1:4317"));
        assert_eq!(env_get(&env, "TELEMETRY").as_deref(), Some("on"));
        assert_eq!(env_get(&env, "INSTALL_MODE").as_deref(), Some("desktop"));
        assert_eq!(env_get(&env, "HOST_COMPUTER_TOKEN"), Some(fs::read_to_string(folder.host_token()).unwrap()));
        assert!(env_get(&env, "AGENTES_SECRET").is_some_and(|s| s.len() == 64));
        assert!(key.len() >= 43 && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&folder.0), 0o700);
            for p in [folder.env(), folder.owner_key(), folder.host_token()] {
                assert_eq!(mode(&p), 0o600, "{}", p.display());
            }
        }
        // Again, with the switch off: the same secrets and port, the new choice.
        let secret = env_get(&env, "AGENTES_SECRET");
        prepare(&folder, false, || Some(4320)).unwrap();
        let env = read_env(&folder);
        assert_eq!(env_get(&env, "AGENTES_SECRET"), secret);
        assert_eq!(env_get(&env, "PORT").as_deref(), Some("4317"));
        assert_eq!(env_get(&env, "TELEMETRY").as_deref(), Some("off"));
        assert_eq!(fs::read_to_string(folder.owner_key()).unwrap(), key);
        assert_eq!(installed(&folder), Installed::App);
        fs::remove_dir_all(folder.0.parent().unwrap()).unwrap();
    }

    #[test]
    fn what_the_folder_holds() {
        let folder = Folder(temp("installed").join(".agentes"));
        assert_eq!(installed(&folder), Installed::None);
        fs::create_dir_all(&folder.0).unwrap();
        fs::write(folder.env(), "PORT=4310\n").unwrap();
        assert_eq!(installed(&folder), Installed::Terminal, "a terminal install's folder is never the app's");
        fs::write(folder.owner_key(), "k").unwrap();
        assert_eq!(installed(&folder), Installed::App);
        fs::remove_dir_all(folder.0.parent().unwrap()).unwrap();
    }

    fn fake_bundle(root: &Path, mark: &str) -> PathBuf {
        let bundle = root.join(format!("bundle-{mark}"));
        fs::create_dir_all(bundle.join("server/lib")).unwrap();
        fs::create_dir_all(bundle.join("web")).unwrap();
        fs::write(bundle.join("server/native.js"), mark).unwrap();
        fs::write(bundle.join("server/lib/native.js"), mark).unwrap();
        fs::write(bundle.join("web/index.html"), mark).unwrap();
        bundle
    }

    #[test]
    fn each_version_is_copied_once_and_the_previous_stays() {
        let root = temp("versions");
        let folder = Folder(root.join(".agentes"));
        let one = fake_bundle(&root, "one");
        let two = fake_bundle(&root, "two");
        assert_eq!(install_version(&folder, &one, "0.6.0").unwrap(), Copied::First);
        assert_eq!(current_version(&folder).as_deref(), Some("0.6.0"));
        assert_eq!(install_version(&folder, &one, "0.6.0").unwrap(), Copied::Same);
        fs::create_dir_all(folder.db()).unwrap();
        fs::write(folder.db().join("PG_VERSION"), "17").unwrap();
        assert_eq!(install_version(&folder, &two, "0.7.0").unwrap(), Copied::Update { from: "0.6.0".into() });
        assert_eq!(current_version(&folder).as_deref(), Some("0.7.0"));
        assert_eq!(fs::read_to_string(folder.entry("0.7.0")).unwrap(), "two");
        assert_eq!(fs::read_to_string(folder.entry("0.6.0")).unwrap(), "one", "the previous copy stays");
        assert_eq!(fs::read_to_string(folder.backups().join("db-0.6.0/PG_VERSION")).unwrap(), "17");
        let three = fake_bundle(&root, "three");
        install_version(&folder, &three, "0.8.0").unwrap();
        assert!(!folder.copy("0.6.0").exists(), "only the current copy and the one before it stay");
        assert!(folder.copy("0.7.0").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_setup_that_didnt_finish_leaves_no_database_and_one_that_did_is_never_touched() {
        let folder = Folder(temp("pending").join(".agentes"));
        prepare(&folder, true, || Some(4318)).unwrap();
        let make_database = || {
            fs::create_dir_all(folder.db()).unwrap();
            fs::write(folder.db().join("PG_VERSION"), "17").unwrap();
            fs::create_dir_all(folder.0.join("files")).unwrap();
        };
        // Never finished: the database and its files go, the folder's settings stay.
        make_database();
        fs::write(folder.pending(), "").unwrap();
        discard_unowned(&folder);
        assert!(!folder.db().exists() && !folder.0.join("files").exists() && !folder.pending().exists());
        for kept in [folder.env(), folder.owner_key(), folder.host_token()] {
            assert!(kept.is_file(), "{}", kept.display());
        }
        // One that finished has no mark: never touched.
        make_database();
        discard_unowned(&folder);
        assert!(folder.db().join("PG_VERSION").is_file());
        // Not while a server holds the folder: it goes once that server ended.
        #[cfg(unix)]
        {
            fs::write(folder.pending(), "").unwrap();
            let mut held = Command::new("sh").args(["-c", "sleep 30; :", "native.js"]).spawn().unwrap();
            fs::write(folder.lock(), format!(r#"{{"pid":{}}}"#, held.id())).unwrap();
            discard_unowned(&folder);
            assert!(folder.db().is_dir() && folder.pending().is_file());
            let _ = held.kill();
            let _ = held.wait();
            discard_unowned(&folder);
            assert!(!folder.db().exists() && !folder.pending().exists());
        }
        fs::remove_dir_all(folder.0.parent().unwrap()).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn migrate_ends_at_its_limit_or_on_cancel() {
        let root = temp("migrate");
        let folder = Folder(root.join(".agentes"));
        // The copy's entry is a shell script that never ends, with /bin/sh as Bun.
        install_version(&folder, &fake_bundle(&root, "exec sleep 30"), "0.6.0").unwrap();
        let launch = Launch { bun: "/bin/sh".into(), folder: folder.clone(), version: "0.6.0".into() };
        let started = Instant::now();
        let ran = launch.run(&["migrate"], Duration::from_millis(300), &|| false).unwrap();
        assert_eq!((ran.code, ran.cut), (None, Some(crate::Cut::TooLong)));
        let ran = launch.run(&["migrate"], ANSWER_WITHIN, &|| true).unwrap();
        assert_eq!((ran.code, ran.cut), (None, Some(crate::Cut::Stopped)));
        assert!(started.elapsed() < Duration::from_secs(3));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_update_that_doesnt_start_goes_back_with_its_database() {
        let root = temp("back");
        let folder = Folder(root.join(".agentes"));
        install_version(&folder, &fake_bundle(&root, "one"), "0.6.0").unwrap();
        fs::create_dir_all(folder.db()).unwrap();
        fs::write(folder.db().join("data"), "before").unwrap();
        install_version(&folder, &fake_bundle(&root, "two"), "0.7.0").unwrap();
        // The new version migrated the database, then never answered.
        fs::write(folder.db().join("data"), "migrated").unwrap();
        assert_eq!(
            next_after(false, Some(1), false, MAX_FAILED_STARTS, Some("0.6.0")),
            Next::GoBack { to: "0.6.0".into() }
        );
        // Not while a server holds the folder, even one started by hand that doesn't name it.
        fs::write(folder.db().join("data"), "migrated").unwrap();
        let mut held = Command::new("sh").args(["-c", "sleep 30; :", "native.js"]).spawn().unwrap();
        fs::write(folder.lock(), format!(r#"{{"pid":{}}}"#, held.id())).unwrap();
        assert!(go_back(&folder, "0.7.0", "0.6.0").is_err());
        assert_eq!(fs::read_to_string(folder.db().join("data")).unwrap(), "migrated");
        assert!(install_version(&folder, &fake_bundle(&root, "three"), "0.8.0").is_err(), "no copy aside under it");
        let _ = held.kill();
        let _ = held.wait();
        fs::remove_file(folder.lock()).unwrap();
        go_back(&folder, "0.7.0", "0.6.0").unwrap();
        assert_eq!(current_version(&folder).as_deref(), Some("0.6.0"));
        assert_eq!(fs::read_to_string(folder.db().join("data")).unwrap(), "before");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn after_an_exit() {
        assert_eq!(next_after(true, Some(0), true, 0, None), Next::Nothing);
        assert_eq!(next_after(false, Some(1), true, 0, None), Next::Restart(Duration::from_secs(1)));
        assert_eq!(next_after(false, Some(1), false, 1, None), Next::Restart(Duration::from_secs(2)));
        assert_eq!(next_after(false, Some(1), false, 2, None), Next::Restart(Duration::from_secs(4)));
        assert_eq!(next_after(false, None, false, MAX_FAILED_STARTS, None), Next::GiveUp);
        assert_eq!(next_after(false, Some(4), false, 1, Some("0.6.0")), Next::Upgrade { from: Some("0.6.0".into()) });
        assert_eq!(next_after(false, Some(5), false, 1, None), Next::NewPort);
        // A crash after it answered is a restart, never the way back.
        assert_eq!(next_after(false, Some(1), true, 5, Some("0.6.0")), Next::Restart(Duration::from_secs(1)));
        // A taken port or folder counts toward the limit, and never sends an update back.
        assert_eq!(next_after(false, Some(5), false, MAX_FAILED_STARTS, None), Next::GiveUp);
        assert_eq!(next_after(false, Some(5), false, MAX_FAILED_STARTS, Some("0.6.0")), Next::GiveUp);
        assert_eq!(next_after(false, Some(3), false, MAX_FAILED_STARTS, Some("0.6.0")), Next::GiveUp);
    }

    #[test]
    fn a_port_is_free_only_when_nothing_answers_there() {
        // Another program on every address (Node's default listen) leaves 127.0.0.1 bindable with SO_REUSEADDR.
        let wide = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
        assert!(!port_free(wide.local_addr().unwrap().port()));
        let port = wide.local_addr().unwrap().port();
        drop(wide);
        assert!(port_free(port));
    }

    #[test]
    fn usage_off_as_the_server_reads_it() {
        assert!(telemetry_on(None));
        assert!(telemetry_on(Some("on")));
        assert!(telemetry_on(Some("true")));
        for off in ["off", "OFF", "false", "0", "no", "n", "disabled", " off "] {
            assert!(!telemetry_on(Some(off)), "{off}");
        }
    }

    #[test]
    fn a_start_that_hangs_gets_no_more_tries() {
        assert_eq!(failed_starts(0, false), 1);
        // Killed after the whole wait: the way back at once (an update), or no more tries.
        assert_eq!(next_after(false, None, false, failed_starts(0, true), Some("0.6.0")), Next::GoBack { to: "0.6.0".into() });
        assert_eq!(next_after(false, None, false, failed_starts(0, true), None), Next::GiveUp);
    }

    #[test]
    fn only_the_child_that_wrote_server_json_is_the_server() {
        let folder = Folder(temp("ready").join(".agentes"));
        fs::create_dir_all(&folder.0).unwrap();
        assert_eq!(ready_pid(&folder), None, "nothing listens for this folder yet");
        fs::write(folder.ready(), r#"{"pid":4242,"url":"http://127.0.0.1:4310"}"#).unwrap();
        assert_eq!(ready_pid(&folder), Some(4242));
        fs::write(folder.ready(), r#"{"pid":"4242"}"#).unwrap();
        assert_eq!(ready_pid(&folder), None);
        // A pid that is gone, or another program's, isn't a server of this folder.
        fs::write(folder.ready(), format!(r#"{{"pid":{}}}"#, i32::MAX)).unwrap();
        assert_eq!(folder_server(&folder, &folder.ready()), None);
        let mut other = Command::new("sleep").arg("30").spawn().unwrap();
        fs::write(folder.ready(), format!(r#"{{"pid":{}}}"#, other.id())).unwrap();
        assert_eq!(folder_server(&folder, &folder.ready()), None);
        let _ = other.kill();
        let _ = other.wait();
        // A live server of this folder: its command line names native.js and the folder.
        let mut server = Command::new("sh").args(["-c", "sleep 30; :", "native.js"]).arg(&folder.0).spawn().unwrap();
        fs::write(folder.ready(), format!(r#"{{"pid":{}}}"#, server.id())).unwrap();
        assert_eq!(folder_server(&folder, &folder.ready()), Some(server.id()));
        let _ = server.kill();
        let _ = server.wait();
        fs::remove_dir_all(folder.0.parent().unwrap()).unwrap();
    }

    #[test]
    fn the_server_here_s_pages_open_at_its_address_for_people() {
        let page = |u: &str| u.parse::<Url>().unwrap();
        let (local, public) = ("http://127.0.0.1:4310", "https://ana-mac.tail1234.ts.net");
        assert_eq!(
            moved_page(page("http://127.0.0.1:4310/org/o1/c/c2?m=1#x"), local, public).as_str(),
            "https://ana-mac.tail1234.ts.net/org/o1/c/c2?m=1#x"
        );
        assert_eq!(moved_page(page("https://app.agentes.chat/org/o1"), local, public).as_str(), "https://app.agentes.chat/org/o1");
        assert_eq!(moved_page(page("http://127.0.0.1:4310/x"), local, local).as_str(), "http://127.0.0.1:4310/x");
    }

    #[test]
    fn http_reads_plain_and_chunked_bodies() {
        assert_eq!(dechunk(b"5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n"), b"hello world");
        // Sizes count bytes: a chunk may end inside a character, and a crafted one never panics.
        assert_eq!(dechunk("1\r\n\u{e9}\r\n0\r\n\r\n".as_bytes()), vec![0xc3]);
        assert_eq!(dechunk(b"1\r\n\xc3\r\n1\r\n\xa9\r\n0\r\n\r\n"), "\u{e9}".as_bytes());
        assert_eq!(dechunk(b"zz\r\nhello\r\n"), b"");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            for reply in [
                "HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\n{\"status\":\"ok\"}",
                "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nb\r\n{\"token\":1}\r\n0\r\n\r\n",
            ] {
                let (mut s, _) = listener.accept().unwrap();
                let mut buf = [0u8; 2048];
                let n = s.read(&mut buf).unwrap();
                assert!(String::from_utf8_lossy(&buf[..n]).contains(&format!("Host: 127.0.0.1:{port}")));
                s.write_all(reply.as_bytes()).unwrap();
            }
        });
        assert_eq!(http(port, "GET", "/api/health", None), Some((200, "{\"status\":\"ok\"}".into())));
        assert_eq!(http(port, "POST", "/x", Some(&json!({}))), Some((200, "{\"token\":1}".into())));
        server.join().unwrap();
    }

    /// The real server, end to end, as the app runs it: `AGENTES_TEST_RUNNER` (the runner compiled with
    /// `bun build --compile`, as the app ships it) and `AGENTES_TEST_SERVER` (a folder built by
    /// `bun scripts/native-package.ts folders`, holding `server/` and `web/`). Skipped without them.
    #[test]
    fn the_real_server_from_setup_to_stop() {
        let (Ok(bun), Ok(built)) = (std::env::var("AGENTES_TEST_RUNNER"), std::env::var("AGENTES_TEST_SERVER")) else {
            eprintln!("skipped: AGENTES_TEST_RUNNER and AGENTES_TEST_SERVER aren't set");
            return;
        };
        let root = temp("real");
        let folder = Folder(root.join(".agentes"));
        let port = free_port().unwrap();
        prepare(&folder, false, || Some(port)).unwrap();
        assert_eq!(install_version(&folder, Path::new(&built), "0.0.1").unwrap(), Copied::First);
        let launch = Launch { bun: bun.into(), folder: folder.clone(), version: "0.0.1".into() };
        let started = Instant::now();
        let ran = launch.run(&["migrate"], ANSWER_WITHIN, &|| false).unwrap();
        assert_eq!(ran.code, Some(0), "migrate: {}", ran.err);
        eprintln!("migrated in {:?}", started.elapsed());

        let mut child = launch.spawn().unwrap();
        let since = Instant::now();
        while !healthy(port) {
            assert!(child.try_wait().unwrap().is_none(), "the server stopped before it answered");
            assert!(since.elapsed() < ANSWER_WITHIN, "no answer in 3 minutes");
            std::thread::sleep(Duration::from_millis(200));
        }
        eprintln!("answered in {:?}", since.elapsed());
        let ready: Value = serde_json::from_str(&fs::read_to_string(folder.ready()).unwrap()).unwrap();
        assert_eq!(ready["url"], json!(loopback_url(port)));
        // The app trusts the answer only from the process it spawned: the server names that very pid.
        assert_eq!(ready_pid(&folder), Some(child.id()));
        assert_eq!(folder_server(&folder, &folder.ready()), Some(child.id()));
        // A second one on the same folder is refused (the lock): exit 3.
        let second = launch.run(&[], ANSWER_WITHIN, &|| false).unwrap();
        assert_eq!(second.code, Some(exit::LOCKED), "{}", second.err);

        // The owner: made once with no password, then a one-time sign-in on every call.
        let first = owner_sign_in(&folder, port, Some(("Ana Souza", "ana@example.com"))).unwrap();
        let again = owner_sign_in(&folder, port, None).unwrap();
        assert_ne!(first, again);
        let wrong = http(port, "POST", "/api/auth/owner-key", Some(&json!({ "key": "x".repeat(43) })));
        assert_eq!(wrong.map(|r| r.0), Some(401));
        let instance = http(port, "GET", "/api/instance", None).unwrap();
        assert!(instance.1.contains("\"ownerClaim\":false"), "{}", instance.1);

        // This computer as the agents' computer: the same binary, as the runner this time, once.
        let state = root.join(".agentes-runner");
        let out = Command::new(&launch.bun)
            .env_remove("BUN_BE_BUN")
            .args(["host", "--once", "--server", &loopback_url(port), "--token-file"])
            .arg(folder.host_token())
            .arg("--state")
            .arg(&state)
            .output()
            .unwrap();
        let line: Value = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
        assert_eq!(line["status"], json!("on"), "{}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(line["homes"], json!([]), "no organization yet");

        // A graceful stop: SIGTERM, it drains and exits 0, and says it isn't ready any more.
        let pid = child.id();
        let done = Arc::new(Mutex::new(None));
        let waiter = {
            let done = done.clone();
            std::thread::spawn(move || {
                let status = child.wait().unwrap();
                *done.lock().unwrap() = Some(status.code());
            })
        };
        stop_pid(pid, STOP_GRACE, || done.lock().unwrap().is_some());
        waiter.join().unwrap();
        assert_eq!(*done.lock().unwrap(), Some(Some(0)));
        assert!(!folder.ready().exists());
        fs::remove_dir_all(&root).unwrap();
    }
}
