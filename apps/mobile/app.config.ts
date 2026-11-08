import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * The app's Expo config. Builds: Android on the "Android build" workflow on GitHub Actions, or EAS (see
 * README.md). The native projects are made from this file by `expo prebuild` and never committed.
 * - `EXPO_PUBLIC_API_URL`: the server the app talks to by default (production); people can pick their own.
 * - `EAS_PROJECT_ID`: overrides the EAS project (the iPhone's Expo push tokens need it); defaults to ours on expo.dev.
 * - `APP_VARIANT`: "development" | "preview" | "production" (from eas.json or the workflow), so the three install
 *   side by side.
 * - `GOOGLE_SERVICES_JSON`: path to Firebase's google-services.json, for push on Android (FCM).
 * - `ANDROID_VERSION_CODE`: the build's version code, set by the Android workflow (EAS numbers its own builds).
 *
 * The New Architecture is the only one since SDK 55, so there is no `newArchEnabled` flag any more
 * (the SDK 58 config type no longer has it). Edge-to-edge on Android is likewise always on.
 */
const variant = process.env.APP_VARIANT ?? "production";
const suffix = variant === "production" ? "" : `.${variant}`;
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "https://app.agentes.chat";
// Links to this host open the app (universal links / App Links); the server publishes the matching /.well-known
// files (apps/server/src/app-links.ts).
const linkHost = new URL(apiUrl).host;

/**
 * The website's pages that open the app on Android (its intent filters; `*` is any text), the same list the server
 * gives iOS (`APP_LINK_PATHS` in apps/server/src/app-links.ts, a test keeps them equal): what the app has a screen for
 * (`appLinkFromUrl`, src/features/links/app-links.ts). Settings sections are listed one by one: Android can't
 * leave a page out of a filter, and billing (Stripe returns there) must stay the website's. A change here reaches
 * phones only with a new build.
 */
export const APP_LINK_PATTERNS = [
  "/invite/*",
  "/reset-password",
  "/signup",
  "/org/*/home",
  "/org/*/dashboards",
  "/org/*/dashboards/*",
  "/org/*/c/*",
  "/org/*/dm/*",
  "/org/*/threads",
  "/org/*/threads/*",
  "/org/*/agents/*",
  "/org/*/approvals",
  "/org/*/proposals",
  "/org/*/task-manager",
  "/org/*/notifications",
  "/org/*/issues",
  "/org/*/issues/*",
  "/org/*/routines",
  "/org/*/search",
  "/org/*/drive",
  "/org/*/wiki",
  "/org/*/wiki/*",
  "/org/*/members",
  "/org/*/settings",
  "/org/*/settings/account",
  "/org/*/settings/notifications",
  "/org/*/settings/apps",
  "/org/*/settings/general",
  "/org/*/settings/members",
  "/org/*/settings/audit",
  "/org/*/settings/access",
  "/org/*/settings/connectors",
  "/org/*/settings/skills",
  "/org/*/settings/keys",
  "/org/*/settings/storage",
  "/org/*/settings/computers",
  "/org/*/settings/usage",
  "/org/*/settings/import",
  "/org/*/settings/media",
  "/org/*/settings/approvals",
  "/org/*/settings/right_hand",
  "/org/*/settings/roles",
  "/org/*/settings/vault",
  "/org/*/settings/about",
  "/org/*/settings/computers/*",
];
// Our EAS project on expo.dev (not a secret: it only names the project).
const projectId = process.env.EAS_PROJECT_ID ?? "8514d5b3-87e0-4980-89a0-4c692f6f4702";
// expo-image-picker and expo-camera both set iOS's camera text: one text for both uses.
const CAMERA_USE = "To take pictures for your conversations and scan QR codes.";

/**
 * Paths the app no longer has (the old Início and Conversas routes), sent to Conversas (`/`) so a stale link,
 * notification or restored URL never lands on "not found". expo-router applies these to deep links and to
 * in-app navigation alike. (`/search` is the search tab again.)
 */
export const LEGACY_REDIRECTS = [
  { source: "/chats", destination: "/" },
  { source: "/home", destination: "/" },
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: variant === "production" ? "agentes" : `agentes ${variant}`,
  slug: "agentes",
  scheme: "agenteschat",
  version: "0.1.0",
  // Upright everywhere (the plugin below); only the agent's screen, in control, lies down (`useSideways`).
  orientation: "default",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: `chat.agentes.app${suffix}`,
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: [`applinks:${linkHost}`],
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: `chat.agentes.app${suffix}`,
    // Firebase's config comes from the build's environment, so the public repo carries none and a self-built app
    // brings its own Firebase project.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    ...(process.env.ANDROID_VERSION_CODE ? { versionCode: Number(process.env.ANDROID_VERSION_CODE) } : {}),
    // Two layers (the night sky, the tilted agent), so the launcher's mask and motion cut them like the iOS icon.
    adaptiveIcon: {
      foregroundImage: "./assets/images/adaptive-icon.png",
      backgroundImage: "./assets/images/adaptive-icon-background.png",
      backgroundColor: "#02060f",
    },
    predictiveBackGestureEnabled: false,
    // Never read the phone's photos or play in the background: the image picker is Android's photo picker, Salvar em
    // Fotos only adds (MediaStore needs no permission for it) and voice messages stop when the app leaves. Google
    // Play asks a justification for the media reads and a video for a media-playback foreground service, so keep
    // them out even if a library's manifest brings them.
    blockedPermissions: [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: APP_LINK_PATTERNS.map((pattern) => ({
          scheme: "https",
          host: linkHost,
          pathPattern: pattern.replace(/\*/g, ".*"),
        })),
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  // Native permission texts (the OS shows them before the app's i18n runs). Only ready languages
  // (@agenteschat/i18n/locale), here and in `supportedLocales`: the stores list these as the app's languages.
  locales: {
    en: "./assets/locales/en.json",
    "pt-BR": "./assets/locales/pt-BR.json",
    es: "./assets/locales/es.json",
    fr: "./assets/locales/fr.json",
    de: "./assets/locales/de.json",
    it: "./assets/locales/it.json",
    nl: "./assets/locales/nl.json",
    ja: "./assets/locales/ja.json",
    ko: "./assets/locales/ko.json",
    "zh-Hans": "./assets/locales/zh-Hans.json",
    id: "./assets/locales/id.json",
    tr: "./assets/locales/tr.json",
    pl: "./assets/locales/pl.json",
    ru: "./assets/locales/ru.json",
  },
  plugins: [
    ["expo-router", { redirects: LEGACY_REDIRECTS }],
    ["expo-screen-orientation", { initialOrientation: "PORTRAIT_UP" }],
    "expo-secure-store",
    // Every ready language, so Android 13+ and iOS offer it as the app's own language.
    [
      "expo-localization",
      {
        supportedLocales: ["en", "pt-BR", "es", "fr", "de", "it", "nl", "ja", "ko", "zh-Hans", "id", "tr", "pl", "ru"],
      },
    ],
    "expo-web-browser",
    "expo-apple-authentication",
    [
      "expo-splash-screen",
      {
        // The first frame of the animated splash (src/features/launch): same image, size and background as
        // the app (white in light), so the hand-over doesn't show. Keep LOGO in launch/logic.ts in step.
        image: "./assets/images/splash-icon.png",
        imageWidth: 120,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: { image: "./assets/images/splash-icon.png", backgroundColor: "#0f0f0e" },
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/images/notification-icon.png",
        color: "#0063d1",
      },
    ],
    // Android release builds signed with the upload key from the environment (the Android build workflow).
    "./plugins/with-android-release-signing",
    [
      "expo-image-picker",
      {
        photosPermission: "To send pictures in your conversations.",
        cameraPermission: CAMERA_USE,
      },
    ],
    [
      // Escanear QR code (Seu servidor): QR codes only, so no microphone.
      "expo-camera",
      { cameraPermission: CAMERA_USE, microphonePermission: false, recordAudioAndroid: false },
    ],
    [
      // Mensagens de voz (ADR 0100): the app records only while the person holds or locks the button.
      "expo-audio",
      // No background playback (the plugin's default is on): it would add a media-playback foreground service.
      {
        microphonePermission: "To record voice messages in your conversations.",
        recordAudioAndroid: true,
        enableBackgroundPlayback: false,
      },
    ],
    [
      // Salvar em Fotos: add-only access (the read text matches expo-image-picker's). No granular reads on Android:
      // saveToPhotos asks write-only, which needs none from Android 13 on.
      "expo-media-library",
      {
        photosPermission: "To send pictures in your conversations.",
        savePhotosPermission: "To save pictures from your conversations to Photos.",
        granularPermissions: [],
      },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    apiUrl,
    variant,
    ...(projectId ? { eas: { projectId } } : {}),
  },
  runtimeVersion: { policy: "appVersion" },
});
