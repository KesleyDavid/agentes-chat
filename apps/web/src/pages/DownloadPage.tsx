import { useDesktopLatest } from "@agenteschat/client";
import { formatBytes } from "@agenteschat/client/lib/files";
import { downloadHref } from "@agenteschat/client/lib/machines";
import { Button, Icon, Logo, Segmented } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBuildName } from "@/components/devices/parts";
import { buildTarget, INSTALL_SYSTEMS, InstallSteps, type InstallSystem } from "@/components/install/guide";
import { LanguageSelect } from "@/components/LanguageSelect";
import { DownloadSky } from "@/components/Sky";
import { useDesktopHere } from "@/hooks/useDesktopHere";
import { useDocumentTitle } from "@/lib/desktop";

/**
 * `/download`, public on every server (ADR 0036 §10): the app's newest build for this computer's system, why the
 * system asks the first time while the app is in beta, and each step with its drawing. The system switch shows the
 * other systems' steps and download; Windows and Linux also come for ARM64 (a link switches). `initial` and
 * `initialArm` come from `?system=` and `?arch=arm64`; otherwise the computer's own.
 */
export function DownloadPage({ initial, initialArm }: { initial?: InstallSystem; initialArm?: boolean }) {
  const { t, i18n } = useTranslation();
  const here = useDesktopHere();
  const buildName = useBuildName();
  const [picked, setPicked] = useState<InstallSystem | undefined>(initial);
  const [armPicked, setArmPicked] = useState<boolean | undefined>(initialArm);
  const hereSystem: InstallSystem = here?.target === "darwin" ? "mac" : (here?.target ?? "mac");
  const system = picked ?? hereSystem;
  const arm = system !== "mac" && (armPicked ?? (system === hereSystem && here?.arch === "aarch64"));
  const target = buildTarget({ system, arm });
  const build = useDesktopLatest(target.target, target.arch);
  const release = build.data ?? null;
  const name = buildName({ target: target.target, arm });
  const hero = useRef<HTMLElement>(null);
  useDocumentTitle(t("install.page.docTitle"));
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="dlp">
      <DownloadSky clear={() => [hero.current]} />
      <header className="dlp__bar">
        <Link to="/" aria-label={t("legal.home")}>
          <Logo size={24} />
        </Link>
        <span className="dlp__bar-end">
          <LanguageSelect signedIn={false} align="end" />
          <Button asChild size="sm" variant="ghost">
            <Link to="/">{t("install.page.open")}</Link>
          </Button>
        </span>
      </header>
      <main className="dlp__main">
        <section className="dlp__hero" ref={hero}>
          <img className="dlp__icon" src="/icon-512.png" alt="" />
          <div>
            <h1>
              {t("install.page.title")}
              <span className="dlp__beta">
                <Icon name="bolt" size={14} />
                {t("install.page.beta")}
              </span>
            </h1>
            <p>{t("install.page.text")}</p>
          </div>
          <div className="dlp__get">
            {release ? (
              <>
                <Button asChild size="lg" variant="primary">
                  <a href={downloadHref(release.url, origin)} download>
                    <Icon name="download" />
                    {t("devices.downloadFor", { system: name })}
                  </a>
                </Button>
                <small>
                  {release.size
                    ? t("install.page.versionSize", {
                        version: release.version,
                        size: formatBytes(i18n.language, release.size),
                      })
                    : t("install.page.version", { version: release.version })}
                </small>
              </>
            ) : build.isPending ? (
              <Button size="lg" variant="primary" icon="download" loading disabled>
                {t("devices.downloadFor", { system: name })}
              </Button>
            ) : (
              <p className="dlp__get-note">
                {build.isError ? t("install.page.unavailable") : t("install.page.soon", { system: name })}
              </p>
            )}
            {system !== "mac" && (
              <button type="button" className="ac-link dlp__arch" onClick={() => setArmPicked(!arm)}>
                {arm ? t("install.page.useX64") : t("install.page.useArm")}
              </button>
            )}
          </div>
        </section>

        <section className="dlp__why" aria-labelledby="dlp-why">
          <Icon name="shield" size={20} />
          <div>
            <h2 id="dlp-why">{t("install.page.whyTitle")}</h2>
            <p>{t("install.page.whyText")}</p>
            <ul className="dlp__marks">
              <li>
                <Icon name="check" size={16} />
                {t("install.page.openSource")}
              </li>
              <li>
                <Icon name="check" size={16} />
                {t("install.page.onlyHere")}
              </li>
              <li>
                <Icon name="check" size={16} />
                {t("install.page.signedUpdates")}
              </li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="dlp-steps">
          <div className="dlp__guide-head">
            <h2 id="dlp-steps">{t("install.page.installOn", { system: name })}</h2>
            <Segmented
              size="sm"
              label={t("install.page.system")}
              value={system}
              onValueChange={(s) => {
                setPicked(s);
                setArmPicked(undefined);
              }}
              options={INSTALL_SYSTEMS.map((s) => ({
                value: s,
                label: t(`machines.os.${buildTarget({ system: s, arm: false }).target}`),
              }))}
            />
          </div>
          <InstallSteps key={`${system}-${arm}`} build={{ system, arm }} release={release} />
        </section>
      </main>
    </div>
  );
}
