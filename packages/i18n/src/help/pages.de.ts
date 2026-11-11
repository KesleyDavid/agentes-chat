import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

/** The help pages in de: a page not here shows in English. */
export const helpDe: Partial<Record<HelpSlug, HelpDocument>> = {
  "run-on-your-computer": {
    title: "agentes.chat auf deinem Computer ausführen",
    summary:
      "Die agentes.chat-App kann agentes.chat auch selbst ausführen, auf einem Mac, einem PC oder einem Linux-Computer, für dich oder ein kleines Team.",
    sections: [
      {
        id: "how",
        heading: "Wie es läuft",
        blocks: [
          "Es läuft in der App, mit einer eigenen eingebauten Datenbank, und speichert alles in einem Ordner auf diesem Computer, `.agentes` in deinem Benutzerordner. Sonst musst du nichts installieren: kein Docker, keine Datenbank zum Einrichten.",
          "Es startet mit der App und stoppt, wenn du sie beendest. Vor dem Beenden fragt die App nach, denn bis sie wieder offen ist, kann niemand agentes.chat nutzen.",
        ],
      },
      {
        id: "who",
        heading: "Für wen es ist",
        blocks: [
          "Für dich oder ein kleines Team. Ein Mac mini, ein übriger PC oder ein Laptop, der an bleibt, ist ein gutes Zuhause dafür: Richte ihn ein wie unter [Eingeschaltet lassen](#keep-on). Auf einem Mac oder PC führst du agentes.chat mit der App aus, ohne Docker.",
          "Für ein größeres Team sieh dir [Welche Einrichtung passt](/help/install-on-a-server#choose) an. Deine Daten können später auf einen Server umziehen.",
        ],
      },
      {
        id: "keep-on",
        heading: "Eingeschaltet lassen",
        blocks: [
          "Auf einem Computer, den andere nutzen, richtest du es einmal ein:",
          {
            list: [
              "**Bei der Anmeldung öffnen** schaltet sich nach der Einrichtung von selbst ein.",
              "Schalte auf einem Mac die **Automatische Anmeldung** unter **Systemeinstellungen › Benutzer:innen & Gruppen** ein, damit die App nach einem Neustart öffnet. FileVault schaltet die automatische Anmeldung aus.",
              "Schalte auf einem Mac **Nach Stromausfall automatisch starten** unter **Systemeinstellungen › Energie** ein.",
              "Ein Mac bleibt wach, solange der Server läuft und **Von deinem Handy und deinem Team erreichbar** an ist. Unter Windows und Linux schaltest du den Ruhezustand in den Energieeinstellungen des Systems aus.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "Deine Agenten arbeiten auch hier",
        blocks: [
          "Deine Agenten arbeiten auch auf diesem Computer, in eigenen Ordnern, mit einem Browser und mit Claude Code oder Codex, wenn sie hier installiert sind.",
          "Agenten laufen hier als du. **Befehle** sind von Anfang an eingeschaltet, und damit erreichen die Agenten jedes Workspace, der diesen Computer nutzt, alles darauf, auch die Daten des Servers. Ausschalten kannst du sie unter **Einstellungen\u00a0›\u00a0Tools**. Siehe [Was Agenten erreichen können](/help/computers#reach).",
        ],
      },
      {
        id: "another-workspace",
        heading: "Auch einem anderen Workspace leihen",
        blocks: [
          "Die Workspaces des Servers, den du hier betreibst, nutzen diesen Computer von selbst. Damit ihn auch ein Workspace an anderer Stelle nutzen kann, etwa einer auf agentes.chat Cloud, öffne **Einstellungen › Server**, drück **Server hinzufügen…**, melde dich bei diesem Workspace an und drück **Erlauben**, wenn die App fragt.",
          "Jeder Workspace bekommt hier eigene Agenten und Ordner. **Befehle** sind auch für ihn von Anfang an eingeschaltet. Schalte sie in der Frage der App aus, bevor du **Erlauben** drückst, oder später unter **Einstellungen\u00a0›\u00a0Tools**, wo ein Schalter für alle Workspaces auf diesem Computer gilt.",
        ],
      },
      {
        id: "reach",
        heading: "Vom Handy und für dein Team",
        blocks: [
          "**Von deinem Handy und deinem Team erreichbar** bringt agentes.chat in Tailscale, ein privates Netzwerk für deine Geräte: Dein Handy und die Personen, die du einlädst, treten ihm bei, und sonst kann niemand agentes.chat erreichen. Tailscale ist kostenlos: https://tailscale.com/download. Ist es aus, funktioniert agentes.chat nur auf diesem Computer.",
          "Teilt dieser Computer auf Tailscale schon etwas anderes über Port 443, nimmt agentes.chat Port 8443, und seine Adresse endet auf `:8443`.",
        ],
      },
      {
        id: "password",
        heading: "Anmelden auf anderen Geräten",
        blocks: [
          "Der Inhaber startet ohne Passwort: Die App meldet dich auf diesem Computer an. Um dich im Browser eines anderen Computers anzumelden, leg unter **Einstellungen › Dein Konto** eins an. Die Handy-App verbindet sich, wenn du den QR-Code unter **Auf deinem Handy** in **Einstellungen › Server** scannst. Dafür muss **Von deinem Handy und deinem Team erreichbar** an sein.",
        ],
      },
      {
        id: "updates",
        heading: "Updates",
        blocks: [
          "Die App sucht selbst nach Updates und installiert eines, wenn du unter **Einstellungen › Updates** auf **Aktualisieren und neu öffnen** drückst. Der Server und alle Agenten starten damit neu. Vorher wird die Datenbank kopiert, und antwortet die neue Version nicht innerhalb von 3 Minuten, kehrt die App von selbst zur vorherigen Version und ihren Daten zurück.",
        ],
      },
      {
        id: "backups",
        heading: "Backups",
        blocks: [
          "Noch wird nichts von selbst gesichert. **Jetzt sichern** unter **Einstellungen › Server** stoppt den Server kurz und speichert die Datenbank, die Dateien und `.env` in `.agentes/backups` in deinem Benutzerordner. Die zwei neuesten bleiben erhalten.",
          "Kopiere sie ab und zu von diesem Computer weg, auf eine Festplatte oder in einen Cloud-Speicher. Sie enthalten deine Schlüssel: Behalte sie für dich.",
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code und Codex",
        blocks: [
          "Die App findet Claude Code und Codex über den `PATH` deiner Login-Shell und in den üblichen Ordnern wie `~/.local/bin`, `/opt/homebrew/bin` und `/usr/local/bin`. Zeigt **Einstellungen › Tools** **Nicht gefunden**, prüf, ob `claude` oder `codex` in einem neuen Terminalfenster läuft, und beende die App dann und öffne sie neu.",
        ],
      },
      {
        id: "moving",
        heading: "Umzug auf einen Server",
        blocks: [
          {
            list: [
              "Beende die App und exportiere dann die Datenbank mit der Kopie des Servers, die in der App steckt. Auf einem Mac:",
            ],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[Installiere agentes.chat auf einem Server](/help/install-on-a-server), aber starte es noch nicht. Trag in seine `.env` das `AGENTES_SECRET` aus `~/.agentes/.env` ein und starte dann nur die Datenbank: `docker compose up -d postgres`.",
              "Lade den Dump: `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "Starte es mit `docker compose up -d`, kopiere `~/.agentes/files` hinein, wie es die vollständige Anleitung zeigt, und melde dich an wie vorher.",
            ],
          },
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "Der Computer des Workspace",
    summary: "Jeder Workspace bekommt einen eigenen Computer, der immer läuft und auf dem seine Agenten arbeiten.",
    sections: [
      {
        id: "what",
        heading: "Was er ist",
        blocks: [
          "Ein Computer nur für diesen Workspace, der immer läuft. Jeder Agent hat darauf einen eigenen Benutzer, mit eigenem Ordner, Bildschirm, Browser und eigenen Dateien. Auf der Seite eines Agenten kannst du ihm bei der Arbeit zusehen und die Steuerung übernehmen, wenn nötig.",
        ],
      },
      {
        id: "own",
        heading: "Deine eigenen Computer und Handys",
        blocks: [
          "Agenten können auch auf Computern und Handys arbeiten, die du mitbringst: einem Mac oder PC mit der agentes.chat-App, einem Server, einem Android-Handy oder einem iPhone. Siehe [Deine Computer und Handys](/help/computers).",
        ],
      },
      {
        id: "plans",
        heading: "Deine KI-Abos",
        blocks: [
          "Deine Agenten können mit deinem eigenen KI-Abo denken, etwa Claude, ChatGPT, GLM oder Kimi, angemeldet auf diesem Computer: Du brauchst keinen API-Schlüssel. Das Konto bleibt auf diesem Computer, und agentes.chat sieht nie das Passwort oder den Zugang.",
          "Die Abos AI Pro und Ultra von Google funktionieren hier nicht: Die Bedingungen von Google erlauben sie nicht in anderen Produkten. Ein Gemini-API-Schlüssel funktioniert.",
        ],
      },
      {
        id: "size",
        heading: "Seine Größe",
        blocks: ["CPUs, Arbeitsspeicher und Speicherplatz siehst du unter **Einstellungen › Geräte**."],
      },
      {
        id: "trouble",
        heading: "Wenn er nicht mehr antwortet",
        blocks: ["Meist ist er nach ein paar Minuten wieder da, und wir kümmern uns darum: Du musst nichts tun."],
      },
    ],
  },
  computers: {
    title: "Deine Computer und Handys",
    summary:
      "Bring einen Mac, einen PC, einen Linux-Computer, einen Server oder ein Handy mit, und deine Agenten arbeiten darauf. Auf agentes.chat Cloud genauso wie auf einem eigenen Server.",
    sections: [
      {
        id: "app",
        heading: "Mit der agentes.chat-App",
        blocks: [
          "Installiere die App auf dem Computer, öffne sie und melde dich bei deinem Workspace an. Sie fragt **Agenten von <workspace> diesen Mac nutzen lassen?** (diesen PC unter Windows, diesen Computer unter Linux). Wähle, wer ihn nutzen darf, und drück **Erlauben**. Das ist alles.",
          "Schon angemeldet? Schalte den Workspace unter **Einstellungen › Allgemein** in der Karte **Agenten** ein.",
        ],
      },
      {
        id: "web",
        heading: "Über die Website",
        blocks: [
          "Drück unter **Einstellungen › Geräte** auf **Gerät verbinden**:",
          {
            list: [
              "**Dieser Mac** oder **Dieser PC**: öffnet die App, die dich vorher fragt.",
              "**Ein anderer Computer**: Installiere dort die App, melde dich mit deinem Konto an und drück **Erlauben**. Er erscheint hier von selbst.",
              "**Ein Server oder VPS**: Führe eine Zeile in seinem Terminal aus und lass ihn dann beitreten. Die Zeile funktioniert einmal, 10 Minuten lang.",
            ],
          },
          "Mit einem Klick verbindet sich die App nur mit einer Adresse mit https, etwa einer von Tailscale, die auf `.ts.net` endet. Bei einer einfachen http-Adresse nimm die Zeile fürs Terminal.",
        ],
      },
      {
        id: "phones",
        heading: "Handys",
        blocks: [
          "Ein Android-Handy verbindet sich über jeden Computer, der schon verbunden ist: per Kabel oder über WLAN ab Android 14 mit dem Sicherheitsupdate vom Mai 2026. Ein iPhone verbindet sich über einen Mac mit der App und Xcode, den Rest richtet die App ein. Beides beginnt bei **Gerät verbinden**.",
        ],
      },
      {
        id: "who",
        heading: "Wer es nutzen darf",
        blocks: [
          "Ein neues Gerät ist nur für dich: **Nur ich** heißt du und die Agenten, die für dich arbeiten. Öffne es für alle im Workspace oder für bestimmte Personen und Rollen, gleich beim Erlauben oder später auf seiner Seite unter **Einstellungen › Geräte**.",
        ],
      },
      {
        id: "open",
        heading: "Solange die App offen ist",
        blocks: [
          "Agenten arbeiten auf einem Computer nur, solange die App dort läuft und der Computer wach ist. Wenn die App fragt, lass **Bereithalten: agentes.chat bei der Anmeldung öffnen** angehakt. Ein Computer, der aus ist oder schläft, zeigt **Offline**, und die Agenten warten, bis er wieder da ist.",
        ],
      },
      {
        id: "pausing",
        heading: "Pausieren und trennen",
        blocks: [
          "Auf dem Computer pausiert das agentes.chat-Symbol neben der Uhr die Agenten aller Workspaces. Unter **Einstellungen › Allgemein** pausiert der Schalter eines Workspace nur diesen einen, und **Trennen** trennt ihn. Während der Pause startet nichts Neues, und was gerade läuft, wird noch fertig. Beim Trennen bleiben die Ordner der Agenten auf der Festplatte.",
          "Auf der Website trennst du ein Gerät mit **Entfernen** auf seiner Seite.",
        ],
      },
      {
        id: "organizations",
        heading: "Mehrere Workspaces, ein Computer",
        blocks: [
          "Melde dich in derselben App bei jedem Workspace an und drück für jeden **Erlauben**. Workspaces auf agentes.chat Cloud und auf deinen eigenen Servern können sich einen Computer teilen (ab App-Version 0.6.1). Jeder hat dort eigene Agenten und Ordner, und wenn du einen trennst, bleiben die anderen unberührt.",
          "Ein Server, den die App auf diesem Computer ausführt, ist schon verbunden und braucht nichts. Um den Computer auch einem Workspace an anderer Stelle zu leihen, sieh dir [Auch einem anderen Workspace leihen](/help/run-on-your-computer#another-workspace) an.",
          "Nutzt du die App auf einem Laptop nur als Fenster zu deinem Workspace? Wenn sie fragt, ob Agenten den Laptop nutzen dürfen, bleibt sie mit **Nicht jetzt** ein einfaches Fenster.",
        ],
      },
      {
        id: "folders",
        heading: "Ordner",
        blocks: [
          "Jeder Agent hat immer einen eigenen Ordner, in `~/agentes/<workspace>`. Weitere Ordner gibst du nur auf dem Computer selbst frei, nie über die Website: in der App unter **Einstellungen\u00a0›\u00a0Ordner** oder auf einem Server mit `agentes-runner folders allow`. Jeder Workspace gibt seine eigenen Ordner frei: Was du für einen freigibst, gilt nur für dessen Agenten. Einen Ordner zu entfernen löscht nichts. Es nimmt nur den Zugriff weg.",
        ],
      },
      {
        id: "reach",
        heading: "Was Agenten erreichen können",
        blocks: [
          "Agenten laufen als du, der Benutzer des Computers. Ihre Datei-Tools bleiben in ihren Ordnern, aber ein Befehl kann alles lesen, was du lesen kannst:",
          {
            list: [
              "deine Dateien und Anmeldungen",
              "die Ordner anderer Agenten, auch die anderer Workspaces, und die Logins, die ihre Browser speichern",
              "das Token, das diesen Computer verbindet",
              "auf einem Computer, der auch agentes.chat ausführt, dessen Datenbank und Schlüssel in `.agentes`",
            ],
          },
          "agentes.chat lehnt Befehle ab, die seine Schlüssel, Tokens und Anmeldungen nennen, aber das ist eine Regel, keine Mauer. **Befehle** sind von Anfang an eingeschaltet. Schalte sie in der Frage der App aus, bevor du **Erlauben** drückst, oder später unter **Einstellungen\u00a0›\u00a0Tools**, wo ein Schalter für alle Workspaces auf dem Computer gilt. Claude Code und Codex führen ihre eigenen Befehle im Ordner des Agenten aus, nach ihren eigenen Regeln.",
          "Für eine echte Mauer nimm einen Linux-Server. Unter Debian 13, installiert mit `--system`, ist jeder Agent ein eigener Benutzer. Unter Ubuntu teilen sich die Agenten einen Benutzer, `agentes`: Sie sehen die Ordner der anderen, aber nicht deine oder die des Servers. Oder gib den Agenten einen eigenen Computer.",
        ],
      },
    ],
  },
  import: {
    title: "Bring deine Agenten mit",
    summary:
      "Hol Agenten aus einer anderen App oder einem anderen agentes.chat-Workspace, mit ihren Anweisungen, Skills, Routinen und ihrem Gedächtnis.",
    sections: [
      {
        id: "comes",
        heading: "Was mitkommt",
        blocks: [
          {
            list: [
              "Agenten, mit Name, Rolle, Anweisungen und Aussehen.",
              "Skills, eingeschaltet für die Agenten, die sie hatten.",
              "Öffentliche Kanäle, mit den Agenten darin.",
              "Routinen, aktiv und nach ihrem Zeitplan. Pausiere sie unter **Routinen**, wenn du willst.",
              "Gedächtnis: was sich jeder Agent merkt.",
              "Die eigenen Dateien jedes Agenten (der Dateiordner von OpenBot.run, ein OpenClaw-Workspace), in einem Ordner mit seinem Namen im **Drive**. Schlüssel, Logins und Systemdateien bleiben zurück, und nichts, was schon da ist, wird ersetzt.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "Was nie mitkommt",
        blocks: [
          "Schlüssel, Passwörter, Logins und Chatverläufe kommen nie mit: Die Agenten denken mit der KI des Workspace. Manches hat hier noch keine Entsprechung oder sollte nie in einer Datei reisen. Du kannst es später neu anlegen.",
          "Dateien und Ordner werden in deinem Browser gelesen. Ein GitHub-Link geht über den Server des Workspace. Schlüssel- und Login-Dateien werden nie geöffnet, und nichts ändert sich, bevor du bestätigst.",
        ],
      },
      {
        id: "other-apps",
        heading: "Aus einer anderen App",
        blocks: [
          "Wähle **Grok Bot**, **ChatGPT dots** oder **Andere App**. Kopiere die Anfrage, füge sie in dieser App ein und bring dann zurück, was sie liefert: Zieh die Datei hinein oder füge die ganze Antwort ein. Wo das in jeder App geht:",
          {
            list: [
              "**Grok Bot**: im Chat mit deinem Bot. Er antwortet mit dem JSON: Kopiere die ganze Antwort.",
              "**ChatGPT dots**: in einem neuen Chat. Lade die Datei herunter, die es erstellt.",
              "**Claude**: in einer neuen Unterhaltung oder im Projekt deiner Agenten. Lade die Datei herunter, die es erstellt.",
              "**Manus**: in einer neuen Aufgabe. Die Datei steht in den Ergebnissen der Aufgabe.",
              "**Rakazo**: Schick sie an deinen Agenten. Er antwortet mit dem JSON: Kopiere die ganze Antwort.",
              "**OpenBot**: keine Anfrage nötig. Zieh den Tenant-Ordner hinein (agents.yaml, agents/, model.yaml, skills.yaml) oder füge seinen GitHub-Link ein.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "Einen Workspace exportieren",
        blocks: [
          "**Einstellungen\u00a0›\u00a0Import und Export\u00a0›\u00a0Export** lädt eine .json-Datei herunter, um deine Agenten in einen anderen Workspace mitzunehmen oder eine Kopie zu behalten. In der Datei:",
          {
            list: [
              "Agenten, mit Anweisungen, Modell und Aussehen",
              "Skills, mit der ganzen SKILL.md",
              "Öffentliche Kanäle, mit ihren Agenten",
              "Geplante Routinen (sie kommen auf der anderen Seite aktiv an)",
              "Das Gedächtnis, das alle im Workspace sehen können",
            ],
          },
          "Nie darin:",
          {
            list: [
              "API-Schlüssel und Passwörter",
              "Konnektoren und Logins",
              "Computer",
              "Unterhaltungen, Nachrichten und private Kanäle",
              "Nutzung, Kosten und Aktivitätsverlauf",
            ],
          },
          "Um die Datei zu nutzen, öffne im anderen Workspace **Einstellungen\u00a0›\u00a0Import und Export** und zieh die .json hinein.",
        ],
      },
    ],
  },
  wiki: {
    title: "Das Wiki",
    summary: "Was das Unternehmen weiß, in Seiten, die miteinander verlinkt sind.",
    sections: [
      {
        id: "links",
        heading: "Links",
        blocks: [
          "Tippe [[, um eine andere Seite zu verlinken. Rückverweise und der Graph zeigen, wie Seiten zusammenhängen.",
        ],
      },
      {
        id: "agents",
        heading: "Wie Agenten es nutzen",
        blocks: ["Agenten lesen das Wiki, wenn sie antworten. Sie schreiben nur darin, wenn jemand darum bittet."],
      },
      {
        id: "obsidian",
        heading: "Einen Obsidian-Vault mitbringen",
        blocks: [
          "Zieh den Ordner des Vaults oder eine .zip davon in den Schritt Kontext der Einrichtung oder in den Import des Wikis. [[Links]], [[notiz|alias]] und [[notiz#abschnitt]] funktionieren weiter. Tags kommen aus dem Frontmatter und dem Text. Anhänge landen im Drive, und eingebettete Bilder und Dateien werden zu Karten auf der Seite. Callouts bleiben Callouts. Dataview-Abfragen kommen als Text an: Bitte einen Agenten, die Tabelle zu bauen. Canvases und die Einstellungen von Obsidian (.obsidian) bleiben draußen.",
        ],
      },
    ],
  },
  memory: {
    title: "Gedächtnis",
    summary: "Was jeder Agent aus Unterhaltungen und den Korrekturen des Teams lernt.",
    sections: [
      {
        id: "learns",
        heading: "Wie Agenten lernen",
        blocks: [
          "Agenten lernen aus Unterhaltungen und aus den Korrekturen des Teams. Was ein Agent weiß, kommt in seinen Kontext, wenn es relevant ist. Im Tab **Gedächtnis** kannst du bearbeiten, anheften oder archivieren, was falsch oder veraltet ist.",
        ],
      },
      {
        id: "permissions",
        heading: "Das Gedächtnis gibt keine Berechtigungen",
        blocks: [
          "Nichts im Gedächtnis erlaubt einem Agenten mehr. Was er darf, steht weiter unter **Tools und Zugriff**, und heikle Aktionen fragen immer nach einer Freigabe.",
        ],
      },
      {
        id: "proposals",
        heading: "Vorgeschlagene Änderungen",
        blocks: [
          "Wenn sich eine Lektion wiederholt, kann der Agent vorschlagen, seine eigenen Anweisungen oder den Kontext des Workspace zu ändern. Nichts ändert sich, bevor jemand zustimmt, und der Text lässt sich vorher anpassen. Die vorige Version bleibt im Verlauf. Ein abgelehnter Vorschlag wird als Lektion behalten, damit er nicht noch einmal kommt.",
        ],
      },
    ],
  },
  approvals: {
    title: "Freigaben",
    summary: "Heikle Aktionen warten auf einen Menschen, einmal oder für immer.",
    sections: [
      {
        id: "what",
        heading: "Was vorher fragt",
        blocks: [
          "Wenn ein Agent mergen, deployen, zurückrollen, etwas nach außen senden oder Daten löschen will, fragt er vorher, egal welchen Zugriff er hat. Die Anfrage erscheint unter **Freigaben** und in der Unterhaltung, mit der genauen Aktion und dem Grund.",
        ],
      },
      {
        id: "always",
        heading: "Einmal oder immer",
        blocks: [
          "Eine Freigabe gilt für genau eine Aktion, mit ihren Werten. Ändert der Agent irgendetwas, fragt er erneut.",
          "**Immer freigeben** lässt den Agenten diese Art von Aktion ab jetzt mit beliebigen Werten tun, ohne zu fragen. Bei der Anfrage einer Routine macht **Immer in dieser Routine** dasselbe nur für diese Routine. Beides gibt es nie für Merge, Deploy, Rollback und Ähnliches. Rückgängig machen kannst du es unter **Tools und Zugriff** auf der Seite des Agenten oder in den Einstellungen der Routine.",
        ],
      },
      {
        id: "who",
        heading: "Wer freigibt",
        blocks: [
          {
            list: [
              "Der Inhaber des Agenten, für seine Anfragen.",
              "Alle, deren Rolle **Aktionen von Agenten freigeben** hat, für jeden Agenten.",
              "Die Personen, die ein Agent beim Fragen nennt, anstelle seines Inhabers.",
              "Wer jemanden unter **Wer für mich freigibt** vertritt, für das, worum diese Person gebeten wird. Merge, Deploy und andere riskante Aktionen nur, wenn das eingeschaltet ist.",
            ],
          },
          "Eine Aktion im eigenen Postfach von jemandem wartet nur auf diese Person. Neuer Zugriff für einen Agenten wartet auf die, die Agenten verwalten.",
          "Lodi, deine rechte Hand, kann außerdem für dich neue Agenten freigeben, die andere Agenten vorschlagen, und Änderungen an Modell, Budget und Kanälen eines Agenten, nur wenn du darum gebeten hast. Wer dich vertritt und was Lodi freigibt, legst du unter **Einstellungen\u00a0›\u00a0Du\u00a0›\u00a0Freigaben** fest.",
        ],
      },
      {
        id: "refusing",
        heading: "Ablehnen",
        blocks: ["Sag, warum, wenn du willst: Der Agent liest es, passt seinen Plan an und behält es als Lektion."],
      },
      {
        id: "meetings",
        heading: "Meetings",
        blocks: [
          "Agenten schlagen nur Zeiten vor. Einladungen an Menschen gehen immer über die Person, die gefragt hat.",
        ],
      },
    ],
  },
  "who-answers": {
    title: "Wer auf eine Nachricht antwortet",
    summary: "Eine Erwähnung wählt den Agenten. Ohne sie wählt agentes.chat für dich, in dieser Reihenfolge.",
    sections: [
      {
        id: "order",
        heading: "Wie eine Nachricht ihren Agenten findet",
        blocks: [
          "Eine Nachricht, die einen Agenten mit @ erwähnt, geht an diesen Agenten. Eine Nachricht ohne Erwähnung wird von der ersten dieser Optionen gelesen, die der Workspace hat:",
          {
            list: [
              "**Jev**, ein kleines, schnelles Modell für genau solche Entscheidungen.",
              "**Ein kleines Modell über einen der API-Schlüssel des Workspace**, etwa Claude Haiku 5.5 oder GPT-6 Luna.",
              "**Dein eigenes Claude- oder ChatGPT-Abo**, für die Nachrichten, die du schreibst, auf einem Server, den du selbst betreibst. Es liest sie auf dem Computer, auf dem es angemeldet ist, und braucht ein paar Sekunden.",
              "**Einfache Regeln**: Eine Antwort an einen Agenten geht an ihn, ebenso eine Nachricht direkt nach eurer Unterhaltung oder eine Nachricht in einem Kanal, in dem du mit nur einem Agenten bist.",
            ],
          },
          "Wenn nichts davon passt, antwortet kein Agent. Erwähne einen Agenten, um ihn zu rufen.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "Wenn agentes.chat deinen Workspace hostet, ist Jev inklusive. Auf einem Server, den du selbst betreibst, nutzt es den TypeSafe-Schlüssel des Inhabers, etwa US$ 0,0001 pro Nachricht: [Jev einrichten](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "Warum dein Abo nur für deine Nachrichten wählt",
        blocks: [
          "Claude- und ChatGPT-Abos sind persönlich, deshalb wählt dein Abo nur für die Nachrichten, die du schreibst.",
        ],
      },
      {
        id: "see",
        heading: "Sehen, wer gewählt hat",
        blocks: ["Öffne den Haken unter einer Nachricht. Die letzte Zeile sagt, wer die Agenten gewählt hat."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "Ein schnelles Modell von TypeSafe, das schnelle Entscheidungen für deine Agenten trifft. Auf deinem eigenen Server ist es optional, mit eigenem Schlüssel.",
    sections: [
      {
        id: "what",
        heading: "Was es tut",
        blocks: [
          {
            list: [
              "**Wählt, wer antwortet.** Eine Nachricht ohne @-Erwähnung geht in unter einer Sekunde an den richtigen Agenten, auch wenn deine Agenten mit einem Abo denken und du keinen API-Schlüssel hast.",
              "**Hält das Gedächtnis ordentlich.** Es erkennt eine Wiederholung oder eine neuere Tatsache auch in anderen Worten: Die Wiederholung verschmilzt mit dem, was der Agent wusste, und die neuere Tatsache ersetzt die alte. Einmal am Tag räumt es den Rest auf.",
              "**Sieht den Bildschirm.** In ihrem Browser und auf ihrem Desktop finden Agenten Buttons und Felder anhand einer Beschreibung, schauen bei kleinen genauer hin und prüfen am Bild des Bildschirms, ob ein Schritt geklappt hat.",
              "**Liest weniger.** Jede Runde lädt nur die Tools, die der Agent wahrscheinlich braucht, also liest deine KI weniger und kostet weniger.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Ohne Jev",
        blocks: [
          "Alles funktioniert weiter, nur langsamer und weniger sorgfältig.",
          {
            list: [
              "**Wer antwortet:** Ein kleines Modell über einen deiner API-Schlüssel wählt, etwa Claude Haiku 5.5 oder GPT-6 Luna. Ohne Schlüssel wählt das eigene Claude- oder ChatGPT-Abo jeder Person für die Nachrichten, die sie schreibt, in ein paar Sekunden. Sonst erreicht eine Antwort oder Folgenachricht trotzdem ihren Agenten. Erwähne einen Agenten, um ihn zu rufen. [Wie Agenten gewählt werden](/help/who-answers)",
              "**Gedächtnis:** Wiederholungen in denselben Worten verschmelzen weiter. Wiederholungen und Neuerungen in anderen Worten bleiben getrennt.",
              "**Bildschirm:** Agenten nutzen die Nummern auf dem Bildschirm und exakte Namen. Aus Bildern wird nichts gelesen.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "Einrichten",
        blocks: [
          {
            list: [
              "Öffne https://console.typesafe.ai und melde dich mit Google oder deiner E-Mail-Adresse an. Ein neues Konto entsteht auf demselben Weg.",
              "Lade in der Konsole Guthaben auf. Jev ist Prepaid.",
              "Öffne https://console.typesafe.ai/keys, erstelle einen Schlüssel und kopiere ihn sofort.",
              "Öffne in agentes.chat **Einstellungen\u00a0›\u00a0KI und Verbrauch** und füge ihn unter **Jev** ein. Nur die Person, die diesen Server eingerichtet hat, sieht ihn.",
            ],
          },
          "Auf einem Server, den du mit Docker betreibst, kannst du den Schlüssel stattdessen als `TYPESAFE_API_KEY` in `.env` eintragen. Dieser hat Vorrang vor dem in den Einstellungen.",
        ],
      },
      {
        id: "cost",
        heading: "Was es kostet",
        blocks: [
          {
            list: [
              "US$ 0,042 pro Million Tokens, die Jev liest. Seine Antworten sind kostenlos. Zu wählen, wer antwortet, liest etwa 2.500 Tokens, also etwa US$ 0,0001. Ein Screenshot sind etwa 3.900 Tokens.",
              "Gekauftes Guthaben gilt 12 Monate. Schalte in der Konsole das automatische Aufladen ein, damit Jev das Guthaben nicht ausgeht.",
              "**Einstellungen\u00a0›\u00a0KI und Verbrauch** zeigt, wie viele Entscheidungen Jev diesen Monat getroffen hat und was sie gekostet haben.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "Deine Daten",
        blocks: [
          "Was Jev für eine Entscheidung liest:",
          {
            list: [
              "Name und Beschreibung des Kanals, die Nachricht und die paar davor",
              "Namen und Rollen deiner Agenten, den Anfang ihrer Anweisungen und die Tools, die sie nutzen können",
              "Die Gedächtniseinträge, die es vergleicht",
              "Die Aufgabe eines Agenten und den Anfang seiner Tool-Ergebnisse",
              "Das Ziel einer Mission und die Befehle, die ein Agent dafür ausführen will",
              "Die Tools, die eine verbundene App anbietet",
              "Die Seite oder den Bildschirm, den ein Agent gerade nutzt, Screenshots eingeschlossen",
            ],
          },
          "TypeSafe betreibt Jev in den USA und trainiert seine Modelle nicht mit dem, was du sendest. Daten werden so lange aufbewahrt, wie es für den Dienst nötig ist. Null Aufbewahrung gibt es in den Enterprise-Tarifen.",
          "Die Datenschutzerklärung von TypeSafe: https://typesafe.ai/legal/privacy-policy. Der Auftragsverarbeitungsvertrag: https://typesafe.ai/legal/data-processing.",
        ],
      },
      {
        id: "problems",
        heading: "Wenn es stoppt",
        blocks: [
          {
            list: [
              "**Schlüssel nicht akzeptiert:** Erstelle einen neuen Schlüssel und füge ihn unter **Einstellungen\u00a0›\u00a0KI und Verbrauch** ein.",
              "**Kein Guthaben mehr:** Lade in der Konsole Guthaben auf. Jev versucht es innerhalb von 30 Minuten erneut, oder klick auf **Erneut prüfen**.",
              "**Ausgelastet oder nicht erreichbar:** TypeSafe kann Anfragen pro Sekunde begrenzen oder eine Weile nicht antworten. Jev macht von selbst weiter. Deine Limits: https://console.typesafe.ai/rate-limits. Für höhere schreib an sales@typesafe.ai.",
            ],
          },
          "In der Zwischenzeit arbeiten Agenten wie unter [Ohne Jev](/help/jev#without).",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "KI-Apps",
    summary:
      "Gib den Agenten von agentes.chat Aufgaben aus Claude, Cursor oder einer anderen MCP-App, ohne sie zu verlassen, und bekomm die Antwort direkt dort.",
    sections: [
      {
        id: "what",
        heading: "So funktioniert es",
        blocks: [
          "agentes.chat ist ein MCP-Server. Du fügst seine Adresse in deine KI-App ein, meldest dich mit deinem Konto an und wählst einen Workspace. Ab dann kann die App Agenten und Kanäle auflisten, in deinem Namen einem Agenten eine Aufgabe schicken, auf die Antwort warten und letzte Aufgaben lesen.",
          "Zum Beispiel mitten in einer Szene in Unity oder Blender fragst du Claude: „Bitte den Marketing-Agenten um einen Text zum Launch“. Die Nachricht erscheint in agentes.chat als deine, markiert mit **über Claude**, und die Antwort des Agenten kommt zurück zu Claude.",
          "Die Adresse steht unter **Einstellungen\u00a0›\u00a0KI-Apps**. Sie endet auf `/mcp`.",
        ],
      },
      {
        id: "connect",
        heading: "Eine App verbinden",
        blocks: [
          {
            list: [
              "**Claude** (claude.ai, Claude Desktop und Handy): Klick unter **Customize\u00a0›\u00a0Connectors** auf **+ Add**, dann auf **Add custom connector**, nenne ihn agentes.chat, füge die Adresse ein und klick auf **Continue**. Wähle **Sign in now**, klick auf **Add** und autorisiere. In den Team- und Enterprise-Abos fügt der Owner der Claude-Organisation den Konnektor unter Organization settings\u00a0›\u00a0Connectors hinzu, und jede Person klickt unter Customize\u00a0›\u00a0Connectors auf **Connect**. Das kostenlose Claude-Abo bietet Platz für einen eigenen Konnektor.",
              "**Claude Code:** Führe `claude mcp add --transport http --scope user agentes <address>` aus, tippe dann `/mcp`, wähle agentes und **Authenticate**. Nur für den aktuellen Ordner lässt du `--scope user` weg.",
              "**Cursor:** **Zu Cursor hinzufügen** unter **Einstellungen\u00a0›\u00a0KI-Apps** oder die Adresse in `~/.cursor/mcp.json`. Cursor bittet dich bei der ersten Nutzung, dich anzumelden.",
              '**VS Code:** **Zu VS Code hinzufügen** oder die Adresse in `.vscode/mcp.json` mit `"type": "http"`.',
              "**Andere Apps:** ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains und weitere haben jeweils eigene Schritte unter **App verbinden**, mit deiner Adresse schon eingetragen.",
            ],
          },
          "Bei der Anmeldung zeigt agentes.chat, welche App Zugriff möchte und wohin sie zurückkehrt. Mach nur weiter, wenn du die Verbindung gerade selbst gestartet hast.",
        ],
      },
      {
        id: "tools",
        heading: "Was die App kann",
        blocks: [
          {
            list: [
              "`send_to_agent`: schickt eine Nachricht von dir an einen Agenten, in eurer privaten Unterhaltung oder in einem Kanal, und wartet auf die Antwort. Nur mit dem Zugriff **Lesen und Agenten Aufgaben schicken**.",
              "`wait_for_reply`: wartet weiter auf die Antwort zu einer Aufgabe.",
              "`list_agents`: die Agenten, die du siehst.",
              "`list_channels`: die Kanäle, die du liest.",
              "`read_conversation`: letzte Nachrichten eines Kanals, eines Threads oder einer Aufgabe.",
              "`list_recent_tasks`: die Aufgaben, die du aus Apps geschickt hast, und was Agenten gerade tun.",
            ],
          },
          "Die App handelt in deinem Namen und sieht nur, was du siehst. Sie gibt nie Aktionen von Agenten frei: Wenn ein Agent anhält, um eine Freigabe zu erbitten, sagt die Antwort das mit einem Link, und ein Mensch entscheidet in agentes.chat. Einstellungen, Mitglieder oder Berechtigungen ändert sie auch nicht.",
        ],
      },
      {
        id: "workspace",
        heading: "Ein Workspace pro Verbindung",
        blocks: [
          "Jede Verbindung gilt für den Workspace, der bei der Anmeldung gewählt wurde. Für einen anderen Workspace verbindest du die App erneut und wählst den anderen.",
          "Unter **Einstellungen\u00a0›\u00a0KI-Apps** siehst du die verbundenen Apps und wann jede zuletzt genutzt wurde, und du kannst jede davon trennen. Wer Mitglieder verwaltet, sieht die Apps des ganzen Workspace und kann sie ebenfalls trennen. Jede Nachricht, die aus einer App gesendet wird, erscheint im Audit.",
        ],
      },
      {
        id: "tokens",
        heading: "Persönliche Tokens",
        blocks: [
          "Für Skripte und Apps ohne OAuth-Anmeldung erstellst du unter **Einstellungen\u00a0›\u00a0KI-Apps** ein persönliches Token und sendest es im Header `Authorization: Bearer`. Das Token wird einmal angezeigt, funktioniert nur in dem Workspace, in dem es erstellt wurde, und kann nach 30 Tagen, 90 Tagen, 1 Jahr oder nie ablaufen.",
          "Auf einem Server ohne https, von einem anderen Computer aus, nutze ein persönliches Token: Die OAuth-Anmeldung braucht https.",
        ],
      },
      {
        id: "limits",
        heading: "Limits",
        blocks: [
          {
            list: [
              "Bis zu 120 Anfragen pro Minute und 5.000 pro Tag und Verbindung.",
              "Bis zu 20 Nachrichten pro Minute und 500 pro Tag und Person in jedem Workspace.",
              "Ein Warten dauert bis zu 45 Sekunden. Arbeitet der Agent noch, wartet die App erneut.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "Text von anderen",
        blocks: [
          "Antworten enthalten Text, den Agenten und Menschen in agentes.chat geschrieben haben. Die App bekommt diesen Text als Inhalt markiert, nicht als Anweisungen, aber ein Text kann trotzdem versuchen, die App zu etwas anderem zu überreden. Prüfe, was deine App gleich tun will, bevor du bestätigst.",
        ],
      },
      {
        id: "problems",
        heading: "Wenn die Verbindung nicht klappt",
        blocks: [
          {
            list: [
              "**Anfrage abgelaufen:** Die Anmeldeseite gilt 30 Minuten und funktioniert einmal. Geh zurück in die App und verbinde erneut.",
              "**Die App will eine neue Anmeldung:** Die Verbindung wurde getrennt, das Passwort geändert oder du hast den Workspace verlassen. Melde dich aus der App erneut an.",
              "**Cursor hängt an einer alten Anmeldung:** Beende Cursor, lösche den Ordner `~/.mcp-auth` und verbinde erneut.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "agentes.chat auf einem Server installieren",
    summary:
      "Betreibe agentes.chat auf deinem eigenen Server, kostenlos, für dein ganzes Team. Ein Befehl richtet alles ein.",
    sections: [
      {
        id: "choose",
        heading: "Welche Einrichtung passt",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**: für jedes Team, von überall erreichbar. Wir betreiben, aktualisieren und sichern es. Jeder Workspace bekommt einen eigenen Computer, auf dem jeder Agent ein eigener Benutzer ist.",
              "**Dein Computer, mit der App**: für dich oder ein kleines Team, erreichbar, solange dieser Computer an ist. Ein Mac mini, der an bleibt, eignet sich gut. Du aktualisierst mit einem Klick und sicherst von Hand. Agenten laufen auf diesem Computer als du.",
              "**Ein Server**: für ein größeres Team, jederzeit erreichbar. Du aktualisierst mit drei Befehlen, und er kann sich jeden Tag von selbst sichern. Unter Debian 13 ist jeder Agent ein eigener Benutzer.",
            ],
          },
          "Von deinem Computer auf einen Server: [Umzug auf einen Server](/help/run-on-your-computer#moving). Jede Variante kann Agenten aus einer anderen holen, mit [Bring deine Agenten mit](/help/import).",
        ],
      },
      {
        id: "need",
        heading: "Was du brauchst",
        blocks: [
          {
            list: [
              "Einen Server oder VPS mit 64-Bit-Linux, auf x64 oder arm64. Für ein kleines Team sind 2 CPUs, 4 GB Arbeitsspeicher und 20 GB Festplatte ein guter Anfang. Auf einem Mac oder PC [führt die App agentes.chat aus](/help/run-on-your-computer), ohne Docker.",
              "Docker mit Compose. Unter Linux installiert der Installer beides, wenn es fehlt, nachdem er gefragt hat.",
              "Einen Weg hinein: ein kostenloses Tailscale-Konto (der Standard, privat, ohne Domain und ohne offenen Port) oder eine Domain, die auf den Server zeigt, mit offenen Ports 80 und 443.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "Installieren",
        blocks: [
          "Führe auf dem Server aus:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "Der Installer installiert, was fehlt, und stellt dann ein paar Fragen: wie Leute ihn erreichen, E-Mail, ob dieser Server auch der Computer deiner Agenten ist und ob er anonyme Nutzungsstatistiken sendet. Enter nimmt die vorgeschlagene Antwort. Er installiert nach `/opt/agentes` (`~/agentes` für einen Benutzer, der Docker schon nutzen kann) und lädt beim ersten Mal etwa 2 GB herunter.",
          "Am Ende zeigt er die Adresse deines Servers und einen QR-Code für dein Handy. Ihn erneut auszuführen ist sicher: Er behält deine Einstellungen und ergänzt nur, was fehlt.",
          "Mit Node.js 18 oder neuer ist `npx @agenteschat/setup` in einem leeren Ordner dieselbe Einrichtung. Ohne Node läuft sie aus dem Image der App, im aktuellen Ordner, und endet mit den Befehlen, die den Rest starten:",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "Wie Leute ihn erreichen",
        blocks: [
          {
            list: [
              "**Tailscale**, der Standard: privates HTTPS unter `https://agentes.<dein-tailnet>.ts.net`, nur für Geräte in deinem Tailscale-Netz. Schalte vor der Installation MagicDNS und HTTPS unter https://console.tailscale.com/admin/dns ein und erstelle einen Auth-Key unter https://console.tailscale.com/admin/settings/keys, nach dem die Einrichtung fragt.",
              "**Eine öffentliche Domain**: Jeder im Internet kann ihn öffnen, zum Beispiel unter `https://chat.example.com`. Lass die Domain auf den Server zeigen und öffne die Ports 80 und 443. Die Einrichtung holt das Zertifikat und erneuert es, und du legst dein Konto an, bevor die Domain online geht.",
              "**Nur dieser Rechner**: `http://localhost:3000`, zum Ausprobieren auf deinem eigenen Computer.",
            ],
          },
          "Bei Tailscale verlässt der Server dein Netz, wenn sein Key abläuft, nach 180 Tagen. Damit er bleibt, öffne unter https://console.tailscale.com/admin/machines das Menü **⋯** des Servers und wähle **Disable Key Expiry**.",
          "Webhooks, die Routinen starten, und KI-Apps, die von ihren eigenen Servern aus anrufen, brauchen eine öffentliche Adresse. Bei Tailscale öffnet Funnel dieselbe Adresse fürs Internet: Füge Funnel unter https://console.tailscale.com/admin/acls zur Richtlinie deines Tailnets hinzu und setze `TAILSCALE_FUNNEL=true` in `.env`, dann führe `docker compose up -d` aus.",
        ],
      },
      {
        id: "owner",
        heading: "Dein Konto",
        blocks: [
          "Öffne die Adresse deines Servers und registriere dich: Das erste Konto wird Inhaber. Danach ist die Registrierung zu, und Leute kommen per Einladung dazu, über **Einstellungen\u00a0›\u00a0Mitglieder und Einladungen**.",
          "Bei Tailscale brauchen die Leute, die du einlädst, auch dein Tailnet. Lade sie zuerst unter https://console.tailscale.com/admin/users ein und dann in agentes.chat.",
        ],
      },
      {
        id: "email",
        heading: "E-Mail",
        blocks: [
          "Ohne E-Mail schreibt agentes.chat jede E-Mail in sein Log, statt sie zu senden, also lässt sich ein Einladungslink dort kopieren. Passwort zurücksetzen bleibt aus.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "Die Einrichtung nimmt deinen eigenen Mailserver (SMTP) oder den Key einer Resend-kompatiblen API, etwa MillionSend oder Resend. E-Mails kommen von `ping@<Domain deines Servers>`, außer du wählst einen anderen Absender, und diese Domain muss bei deinem E-Mail-Anbieter verifiziert sein. Um es später einzurichten, führe die Installation erneut aus.",
        ],
      },
      {
        id: "phone",
        heading: "Dein Handy",
        blocks: [
          {
            list: [
              "Bei Tailscale installiere die Tailscale-App auf deinem Handy und melde dich im selben Tailnet an.",
              "Installiere die agentes.chat-App.",
              "Scanne den QR-Code, den die Einrichtung gezeigt hat, oder den unter **Einstellungen\u00a0›\u00a0Dein Konto\u00a0›\u00a0Auf dem Handy öffnen**, der dich auch gleich anmeldet.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "Die Computer deiner Agenten",
        blocks: [
          "Die Einrichtung kann diesen Server auch zum Computer deiner Agenten machen, auf dem sie Befehle ausführen, einen Browser nutzen und ihre Dateien ablegen. Sie fragt und schlägt Ja vor, wo der Server das gut kann. Unter Debian 13 bekommt jeder Agent einen eigenen Benutzer, mit einem Bildschirm. Unter Ubuntu teilen sich die Agenten einen Benutzer, `agentes`. Hast du Nein gesagt, führe die Installation mit `--computer yes` erneut aus:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "Weitere Computer, etwa ein Mac mit der agentes.chat-App oder ein anderer Server, verbindest du unter **Einstellungen\u00a0›\u00a0Geräte**, wie in [Deine Computer und Handys](/help/computers). Bei Tailscale treten sie vorher deinem Tailnet bei.",
        ],
      },
      {
        id: "backups",
        heading: "Backups und Wiederherstellung",
        blocks: [
          "Dein Server besteht aus drei Dingen: der Datenbank, den hochgeladenen Dateien und `AGENTES_SECRET` in `.env`. Bewahre eine Kopie von `.env` sicher auf, getrennt von den Backups: Ohne das Secret lassen sich die Keys in einer wiederhergestellten Datenbank nicht lesen.",
          "Für ein tägliches Backup erstelle einen privaten Bucket bei Cloudflare R2 oder einem anderen S3-kompatiblen Speicher und einen Key, der darin lesen, schreiben und löschen darf. Trage beides in `.env` ein, mit `backup` in `COMPOSE_PROFILES` (`https,backup` mit einer öffentlichen Domain):",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "Führe dann im Installationsordner `docker compose up -d` aus. Die Datenbank wird um 03:00 UTC gesichert, und jedes Backup bleibt 14 Tage. `docker compose run --rm backup now` macht sofort eines, und `docker compose run --rm backup list` listet sie auf. Die Backups enthalten nur die Datenbank: Die hochgeladenen Dateien im Volume `files` brauchen eine eigene Kopie, und die vollständige Anleitung unten hat die Befehle.",
          "Zum Wiederherstellen hol ein Backup mit `docker compose run --rm -T backup fetch <name> > agentes.dump` und lade es bei gestoppter App in eine leere Datenbank:",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "Stelle in der Version wieder her, die das Backup gemacht hat, oder in einer neueren.",
        ],
      },
      {
        id: "upgrades",
        heading: "Updates",
        blocks: [
          "Führe im Installationsordner aus:",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "Die Datenbank aktualisiert sich selbst, wenn die neue Version startet. Lass deine Einstellungen in `.env` und bearbeite `docker-compose.yml` nie, denn jedes Update ersetzt die Datei. Mach vor einem großen Sprung ein Backup: Eine Datenbank, die eine neuere Version aktualisiert hat, öffnet sich nicht in einer älteren.",
        ],
      },
      {
        id: "data",
        heading: "Was er sendet",
        blocks: [
          "Einmal am Tag sendet der Server agentes.chat anonyme Nutzungsstatistiken: Zahlen wie Personen, Agenten, Größe der Rechner, verbrauchte KI-Tokens und wie viele Daten die Browser der Agenten senden und empfangen. Nie Nachrichten, Dateien, Namen oder Websites. `docker compose run --rm agentes telemetry` zeigt genau, was gesendet würde. Der Inhaber schaltet das unter **Einstellungen\u00a0›\u00a0Allgemein** aus, oder mit `TELEMETRY=off` in `.env`.",
          "Fehlerberichte gehen nirgendwohin, außer du setzt `SENTRY_DSN` auf einen Sentry-kompatiblen Server deiner Wahl. Ein Bericht enthält den Fehler und wo er passiert ist, nie Nachrichten, E-Mails, IP-Adressen, Cookies oder Tokens.",
        ],
      },
      {
        id: "reference",
        heading: "Die vollständige Anleitung",
        blocks: [
          "Alle Einstellungen, ein eigener Proxy wie nginx, der Betrieb ohne Docker, ein Ablauf für KI-Agenten, die ihn selbst installieren, und was zu tun ist, wenn etwas fehlschlägt, stehen in `SELF_HOSTING.md` im Repository von agentes.chat.",
        ],
      },
    ],
  },
};
