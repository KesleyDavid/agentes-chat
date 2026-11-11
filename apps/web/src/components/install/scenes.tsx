import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

/*
 * The drawings of the install steps (ADR 0036 §10): each one a 400×250 desktop of the system with the one thing to
 * click ringed and a pointer clicking it. Drawn in HTML, not screenshots, so the system's own words go through the
 * translations, stay sharp and follow the theme. Decorative: the step's words beside them say the same.
 */

export type SceneId =
  | "macDrag"
  | "macBlocked"
  | "macSettings"
  | "macConfirm"
  | "winKeep"
  | "winMore"
  | "winRun"
  | "linuxApt"
  | "linuxOpen";

/** A scene's natural size; boxes scale it (`FitScene`). */
export const SCENE_W = 400;
export const SCENE_H = 250;

const APP = "agentes.chat";
const ICON = "/icon-512.png";
const CLOCK = "9:41";
/** Names the systems show as they are, in every language. */
const FILEVAULT = "FileVault";
const DOWNLOADS = "~/Downloads";

function Pointer({ drag = false }: { drag?: boolean }) {
  return (
    <svg className={drag ? "isc-ptr isc-ptr--drag" : "isc-ptr"} viewBox="0 0 16 20" aria-hidden="true">
      <path
        d="M1.6 1.2v15l3.8-3.6 2.5 5.7 2.6-1.1-2.5-5.6h5.3z"
        fill="#111"
        stroke="#fff"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const AppIcon = ({ className = "isc-icon" }: { className?: string }) => (
  <img className={className} src={ICON} alt="" draggable={false} />
);

const Lights = () => (
  <span className="isc-lights">
    <i />
    <i />
    <i />
  </span>
);

/** The ringed thing to click, with the pointer on it. */
function Hit({
  as: Tag = "span",
  className,
  children,
}: {
  as?: "span" | "div";
  className: string;
  children: ReactNode;
}) {
  return (
    <Tag className={`${className} isc-hl`}>
      {children}
      <Pointer />
    </Tag>
  );
}

function Mac({ children, app = false, dock = true }: { children: ReactNode; app?: boolean; dock?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="isc isc--mac">
      <div className="isc-menubar">
        <span className="isc-menubar__mark" />
        <b>{t("install.scene.finder")}</b>
        <span>{t("install.scene.file")}</span>
        <span>{t("install.scene.edit")}</span>
        <span>{t("install.scene.view")}</span>
        <span>{t("install.scene.window")}</span>
        <span className="isc-menubar__end">
          <span className="isc-battery" />
          {CLOCK}
        </span>
      </div>
      <div className={dock ? "isc-stage" : "isc-stage isc-stage--full"}>{children}</div>
      {dock && (
        <div className="isc-dock">
          <i style={{ "--c": "linear-gradient(#5ac8fa,#1d7cf2)" } as CSSProperties} />
          <i style={{ "--c": "linear-gradient(#ffffff,#d9d9de)" } as CSSProperties} />
          <i style={{ "--c": "linear-gradient(#ff9f0a,#ff6a00)" } as CSSProperties} />
          <i style={{ "--c": "linear-gradient(#8e8e93,#636366)" } as CSSProperties} />
          <i style={{ "--c": "linear-gradient(#34c759,#1f9d43)" } as CSSProperties} />
          {app && <AppIcon className="isc-dock__app" />}
        </div>
      )}
    </div>
  );
}

function Win({ children }: { children: ReactNode }) {
  return (
    <div className="isc isc--win">
      <div className="isc-stage isc-stage--win">{children}</div>
      <div className="isc-taskbar">
        <span className="isc-taskbar__start">
          <s />
          <s />
          <s />
          <s />
        </span>
        <i style={{ "--c": "#ffd65c" } as CSSProperties} />
        <i style={{ "--c": "linear-gradient(#36c0ff,#0a6cff)" } as CSSProperties} />
        <i style={{ "--c": "#7c5cff" } as CSSProperties} />
        <span className="isc-taskbar__clock">{CLOCK}</span>
      </div>
    </div>
  );
}

function Linux({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="isc isc--linux">
      <div className="isc-topbar">
        <span>{t("install.scene.activities")}</span>
        <span>{CLOCK}</span>
        <span className="isc-battery" />
      </div>
      <div className="isc-stage isc-stage--linux">{children}</div>
    </div>
  );
}

/**
 * One install step's drawing. `version` and `file`: the build's, for what the systems show (the installer's or the
 * package's name, x64 or ARM64).
 */
export function Scene({ id, version, file }: { id: SceneId; version: string; file?: string }) {
  const { t } = useTranslation();
  const v = version || "1.0.0";
  const installer = file?.endsWith(".exe") ? file : `agentes_${v}_x64-setup.exe`;
  const deb = file?.endsWith(".deb") ? file : `agentes_${v}_amd64.deb`;
  switch (id) {
    case "macDrag":
      return (
        <Mac>
          <div className="isc-win isc-dmg">
            <div className="isc-win__bar">
              <Lights />
              <span>{APP}</span>
            </div>
            <div className="isc-dmg__in">
              <span className="isc-dmg__item isc-hl">
                <AppIcon />
                <span>{APP}</span>
                <Pointer drag />
              </span>
              <svg className="isc-dmg__arrow" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 6h88" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
                <path d="M88 1l9 5-9 5z" fill="currentColor" />
              </svg>
              <span className="isc-dmg__item">
                <span className="isc-folder">
                  <b>A</b>
                </span>
                <span>{t("install.scene.applications")}</span>
              </span>
              <AppIcon className="isc-ghost" />
            </div>
          </div>
        </Mac>
      );
    case "macBlocked":
      return (
        <Mac app dock={false}>
          <div className="isc-alert">
            <span className="isc-badge">
              <AppIcon />
            </span>
            <b>{t("install.scene.notOpened", { app: APP })}</b>
            <p>{t("install.scene.notOpenedText", { app: APP })}</p>
            <span className="isc-alert__btns">
              <Hit className="isc-capsule isc-capsule--default">{t("install.scene.done")}</Hit>
              <span className="isc-capsule isc-off">{t("install.scene.moveToTrash")}</span>
            </span>
          </div>
        </Mac>
      );
    case "macSettings":
      return (
        <Mac app>
          <div className="isc-win isc-settings">
            <div className="isc-settings__side">
              <Lights />
              <span className="isc-settings__search">{t("install.scene.search")}</span>
              <span className="isc-settings__me">
                <i />
                {t("install.scene.account")}
              </span>
              <SideItem color="#8e8e93">{t("install.scene.general")}</SideItem>
              <SideItem color="#1c1c1e">{t("install.scene.appearance")}</SideItem>
              <SideItem color="#0a84ff">{t("install.scene.accessibility")}</SideItem>
              <SideItem color="#0a84ff" on>
                {t("install.scene.privacy")}
              </SideItem>
              <SideItem color="#1c1c1e">{t("install.scene.desktopDock")}</SideItem>
              <SideItem color="#30b0c7">{t("install.scene.displays")}</SideItem>
            </div>
            <div className="isc-settings__main">
              <div className="isc-settings__top">
                <em>‹ ›</em>
                {t("install.scene.privacy")}
              </div>
              <div className="isc-settings__body">
                <span className="isc-settings__label">{t("install.scene.security")}</span>
                <div className="isc-group">
                  <div className="isc-row">
                    <span>{t("install.scene.allowFrom")}</span>
                    <span className="isc-row__value">{t("install.scene.allowValue")} ⌃⌄</span>
                  </div>
                  <div className="isc-row">
                    <span>{t("install.scene.blocked", { app: APP })}</span>
                    <Hit className="isc-capsule isc-capsule--small">{t("install.scene.openAnyway")}</Hit>
                  </div>
                </div>
                <div className="isc-group">
                  <div className="isc-row">
                    <span>{FILEVAULT}</span>
                    <span className="isc-toggle" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Mac>
      );
    case "macConfirm":
      return (
        <Mac app dock={false}>
          <div className="isc-pair">
            <div className="isc-alert isc-alert--narrow">
              <span className="isc-badge">
                <AppIcon />
              </span>
              <b>{t("install.scene.confirmTitle", { app: APP })}</b>
              <p>{t("install.scene.confirmText")}</p>
              <span className="isc-alert__btns">
                <Hit className="isc-capsule isc-capsule--default">{t("install.scene.openAnyway")}</Hit>
                <span className="isc-capsule isc-off">{t("install.scene.moveToTrash")}</span>
                <span className="isc-capsule isc-off">{t("install.scene.done")}</span>
              </span>
            </div>
            <div className="isc-touchid">
              <svg viewBox="0 0 34 34" aria-hidden="true">
                <path d="M9 11.5a10 10 0 0 1 16 0" />
                <path d="M7 17a10 10 0 0 1 20 0v2" />
                <path d="M11 25a7 7 0 0 1-1-4v-4a7 7 0 0 1 14 0v4" />
                <path d="M14 27a4.5 4.5 0 0 1-1-3v-7a4 4 0 0 1 8 0v6" />
                <path d="M17 17v8" />
              </svg>
              <b>{t("install.scene.touchIdTitle")}</b>
              <span>{t("install.scene.touchIdText")}</span>
              <span className="isc-touchid__field">{t("install.scene.password")}</span>
            </div>
          </div>
        </Mac>
      );
    case "winKeep":
      return (
        <Win>
          <div className="isc-browser">
            <div className="isc-browser__tabs">
              <span>{APP}</span>
            </div>
            <div className="isc-browser__url">
              <span>{typeof window === "undefined" ? APP : `${window.location.host}/download`}</span>
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M5 1v6M2.5 4.5 5 7l2.5-2.5M2 9h6" />
              </svg>
            </div>
            <div className="isc-browser__page">
              <i style={{ width: "60%" }} />
              <i style={{ width: "80%" }} />
              <i style={{ width: "40%" }} />
            </div>
            <div className="isc-flyout">
              <b>{t("install.scene.downloads")}</b>
              <div className="isc-flyout__file">
                <span />
                <div>
                  <b>{installer}</b>
                  <small>{t("install.scene.rare")}</small>
                </div>
              </div>
              <div className="isc-flyout__acts">
                <span className="isc-winbtn isc-off">{t("install.scene.delete")}</span>
                <Hit className="isc-winbtn">{t("install.scene.keep")}</Hit>
              </div>
            </div>
          </div>
        </Win>
      );
    case "winMore":
    case "winRun":
      return (
        <Win>
          <div className="isc-smartscreen">
            <span className="isc-smartscreen__x">✕</span>
            <h4>{t("install.scene.protectedTitle")}</h4>
            <p>{t(id === "winMore" ? "install.scene.protectedText" : "install.scene.protectedShort")}</p>
            {id === "winMore" ? (
              <Hit className="isc-smartscreen__more">{t("install.scene.moreInfo")}</Hit>
            ) : (
              <div className="isc-smartscreen__facts">
                <div>
                  <span>{t("install.scene.appLabel")}</span>
                  {installer}
                </div>
                <div>
                  <span>{t("install.scene.publisher")}</span>
                  {t("install.scene.unknownPublisher")}
                </div>
              </div>
            )}
            <div className="isc-smartscreen__acts">
              {id === "winRun" && <Hit className="isc-ssbtn">{t("install.scene.runAnyway")}</Hit>}
              <span className="isc-ssbtn isc-off">{t("install.scene.dontRun")}</span>
            </div>
          </div>
        </Win>
      );
    case "linuxApt":
      return (
        <Linux>
          <div className="isc-term">
            <div className="isc-term__bar">{DOWNLOADS}</div>
            <div className="isc-term__in">
              <em>{DOWNLOADS}$</em> sudo apt install ./{deb}
              {"\n"}
              {t("install.scene.readingLists")}
              {"\n"}
              {t("install.scene.settingUp", { version: v })}
              {"\n"}
              <em>{DOWNLOADS}$</em> ▌
            </div>
          </div>
        </Linux>
      );
    case "linuxOpen":
      return (
        <Linux>
          <div className="isc-apps">
            <span className="isc-apps__search">{APP.slice(0, 4)}▌</span>
            <div className="isc-apps__row">
              <Hit as="div" className="isc-apps__app">
                <AppIcon />
                <span>{APP}</span>
              </Hit>
            </div>
          </div>
        </Linux>
      );
  }
}

function SideItem({ color, on = false, children }: { color: string; on?: boolean; children: ReactNode }) {
  return (
    <span className={on ? "isc-side isc-side--on" : "isc-side"}>
      <i style={{ "--c": color } as CSSProperties} />
      <span>{children}</span>
    </span>
  );
}
