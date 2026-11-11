import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

/** The help pages in nl: a page not here shows in English. */
export const helpNl: Partial<Record<HelpSlug, HelpDocument>> = {
  "run-on-your-computer": {
    title: "agentes.chat op je eigen computer draaien",
    summary:
      "De agentes.chat-app kan ook agentes.chat zelf draaien, op een Mac, een pc of een Linux-computer, voor jou of een klein team.",
    sections: [
      {
        id: "how",
        heading: "Hoe het draait",
        blocks: [
          "Het draait in de app, met een eigen ingebouwde database, en bewaart alles in één map op deze computer: `.agentes` in je thuismap. Verder hoef je niets te installeren: geen Docker, geen database om in te richten.",
          "Het start met de app en stopt als je de app afsluit. Afsluiten vraagt eerst om bevestiging, want niemand kan agentes.chat gebruiken tot de app weer opent.",
        ],
      },
      {
        id: "who",
        heading: "Voor wie het is",
        blocks: [
          "Voor jou of een klein team. Een Mac mini, een reserve-pc of een laptop die aan blijft, is een goed thuis: stel hem in zoals in [Aan laten staan](#keep-on). Op een Mac of een pc draai je agentes.chat met de app, zonder Docker.",
          "Voor een groter team, zie [Welke opzet je kiest](/help/install-on-a-server#choose). Je gegevens kunnen later naar een server verhuizen.",
        ],
      },
      {
        id: "keep-on",
        heading: "Aan laten staan",
        blocks: [
          "Op een computer die anderen gebruiken, stel je dit één keer in:",
          {
            list: [
              "**Openen bij inloggen** gaat na de installatie vanzelf aan.",
              "Zet op een Mac **Automatisch inloggen** aan in **Systeeminstellingen › Gebruikers en groepen**, zodat de app na een herstart opent. FileVault zet automatisch inloggen uit.",
              "Zet op een Mac **Start automatisch op na een stroomstoring** aan in **Systeeminstellingen › Energie**.",
              "Een Mac blijft wakker zolang de server draait en **Bereik het vanaf je telefoon en je teamgenoten** aanstaat. Zet op Windows en Linux de slaapstand uit in de energie-instellingen van het systeem.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "Je agents werken hier ook",
        blocks: [
          "Je agents werken ook op deze computer, in hun eigen mappen, met een browser, en met Claude Code of Codex als die hier zijn geïnstalleerd.",
          "Agents draaien hier onder jouw naam. **Opdrachten** staan standaard aan, en daarmee kunnen de agents van elke werkruimte die deze computer gebruikt bij alles op deze computer, ook bij de gegevens van de server. Zet ze uit in **Voorkeuren\u00a0›\u00a0Tools**. Zie [Waar agents bij kunnen](/help/computers#reach).",
        ],
      },
      {
        id: "another-workspace",
        heading: "Leen hem ook uit aan een andere werkruimte",
        blocks: [
          "De werkruimtes van de server die je hier draait, gebruiken deze computer vanzelf. Wil je dat een werkruimte ergens anders hem ook gebruikt, zoals een op agentes.chat Cloud, open dan **Voorkeuren › Servers**, druk op **Een server toevoegen…**, meld je aan bij die werkruimte en druk op **Toestaan** als de app het vraagt.",
          "Elke werkruimte krijgt hier eigen agents en mappen. Ook daar staan **Opdrachten** standaard aan. Zet ze uit in de vraag van de app voordat je op **Toestaan** drukt, of later in **Voorkeuren\u00a0›\u00a0Tools**, waar één schakelaar voor alle werkruimtes op deze computer geldt.",
        ],
      },
      {
        id: "reach",
        heading: "Vanaf je telefoon en voor je team",
        blocks: [
          "**Bereik het vanaf je telefoon en je teamgenoten** zet agentes.chat op Tailscale, een privénetwerk voor je apparaten: je telefoon en de mensen die je uitnodigt doen mee, en verder kan niemand agentes.chat bereiken. Tailscale is gratis: https://tailscale.com/download. Staat het uit, dan werkt agentes.chat alleen op deze computer.",
          "Deelt deze computer al iets anders op poort 443 van Tailscale, dan neemt agentes.chat 8443, en eindigt het adres op `:8443`.",
        ],
      },
      {
        id: "password",
        heading: "Inloggen vanaf andere apparaten",
        blocks: [
          "De eigenaar begint zonder wachtwoord: de app logt je in op deze computer. Om in te loggen vanuit een browser op een andere computer, stel je er een in bij **Instellingen › Je account**. De telefoonapp maakt verbinding als je de QR-code scant onder **Op je telefoon**, in **Voorkeuren › Servers**. Daarvoor moet **Bereik het vanaf je telefoon en je teamgenoten** aan staan.",
        ],
      },
      {
        id: "updates",
        heading: "Updates",
        blocks: [
          "De app zoekt zelf naar updates en installeert er een als je op **Bijwerken en opnieuw openen** drukt in **Voorkeuren › Updates**. De server en alle agents starten mee opnieuw op. Eerst wordt de database gekopieerd, en als de nieuwe versie niet binnen 3 minuten reageert, gaat de app vanzelf terug naar de vorige versie en de gegevens daarvan.",
        ],
      },
      {
        id: "backups",
        heading: "Back-ups",
        blocks: [
          "Er wordt nog niets vanzelf geback-upt. **Nu een back-up maken**, in **Voorkeuren › Servers**, stopt de server even en bewaart de database, de bestanden en `.env` in `.agentes/backups`, in je thuismap. De twee nieuwste blijven bewaard.",
          "Kopieer ze af en toe van deze computer af, naar een schijf of een clouddrive. Ze bevatten je sleutels: houd ze privé.",
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code en Codex",
        blocks: [
          "De app vindt Claude Code en Codex via de `PATH` van je login-shell, plus de gebruikelijke mappen zoals `~/.local/bin`, `/opt/homebrew/bin` en `/usr/local/bin`. Staat er in **Voorkeuren › Tools** **Niet gevonden**, controleer dan of `claude` of `codex` werkt in een nieuw Terminal-venster, en sluit de app daarna af en open hem opnieuw.",
        ],
      },
      {
        id: "moving",
        heading: "Verhuizen naar een server",
        blocks: [
          {
            list: [
              "Sluit de app af en maak dan een dump van de database met de eigen kopie van de server in de app. Op een Mac:",
            ],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[Installeer agentes.chat op een server](/help/install-on-a-server), maar start het nog niet. Zet in de `.env` ervan het `AGENTES_SECRET` uit `~/.agentes/.env` en start dan alleen de database: `docker compose up -d postgres`.",
              "Laad de dump: `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "Start het met `docker compose up -d`, kopieer `~/.agentes/files` erin zoals de volledige gids laat zien, en log in zoals eerst.",
            ],
          },
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "De computer van de werkruimte",
    summary: "Elke werkruimte krijgt een eigen computer die altijd aanstaat, waar de agents werken.",
    sections: [
      {
        id: "what",
        heading: "Wat het is",
        blocks: [
          "Een computer alleen voor deze werkruimte, die altijd aanstaat. Elke agent heeft er een eigen gebruiker, met een eigen map, scherm, browser en bestanden. Op de pagina van een agent kun je meekijken terwijl hij werkt, en de controle overnemen als dat nodig is.",
        ],
      },
      {
        id: "own",
        heading: "Je eigen computers en telefoons",
        blocks: [
          "Agents kunnen ook werken op computers en telefoons die je zelf meebrengt: een Mac of een pc met de agentes.chat-app, een server, een Android-telefoon of een iPhone. Zie [Je computers en telefoons](/help/computers).",
        ],
      },
      {
        id: "plans",
        heading: "Je AI-abonnementen",
        blocks: [
          "Je agents kunnen denken met je eigen AI-abonnement, zoals Claude, ChatGPT, GLM of Kimi, ingelogd op deze computer: geen API-sleutel nodig. Het account blijft op deze computer, en agentes.chat ziet nooit het wachtwoord of de toegang.",
          "De abonnementen AI Pro en Ultra van Google werken hier niet: de voorwaarden van Google staan ze niet toe in andere producten. Een Gemini-API-sleutel wel.",
        ],
      },
      {
        id: "size",
        heading: "Hoe groot hij is",
        blocks: ["De CPU's, het geheugen en de schijf staan in **Instellingen › Apparaten**."],
      },
      {
        id: "trouble",
        heading: "Als hij niet meer reageert",
        blocks: ["Meestal is hij binnen een paar minuten terug, en we zijn ermee bezig: je hoeft zelf niets te doen."],
      },
    ],
  },
  computers: {
    title: "Je computers en telefoons",
    summary:
      "Breng een Mac, een pc, een Linux-computer, een server of een telefoon mee, en je agents werken erop. Op agentes.chat Cloud net zo goed als op een eigen server.",
    sections: [
      {
        id: "app",
        heading: "Vanuit de agentes.chat-app",
        blocks: [
          "Installeer de app op de computer, open hem en meld je aan bij je werkruimte. Hij vraagt **Agents van <workspace> deze Mac laten gebruiken?** (deze pc op Windows, deze computer op Linux). Kies wie hem mag gebruiken en druk op **Toestaan**. Dat is alles.",
          "Al aangemeld? Zet de werkruimte aan in **Voorkeuren › Algemeen**, in de kaart **Agents**.",
        ],
      },
      {
        id: "web",
        heading: "Vanaf de website",
        blocks: [
          "Druk in **Instellingen › Apparaten** op **Apparaat koppelen**:",
          {
            list: [
              "**Deze Mac** of **Deze pc**: opent de app, die het je eerst vraagt.",
              "**Een andere computer**: installeer daar de app, meld je aan met je eigen account en druk op **Toestaan**. Hij verschijnt hier vanzelf.",
              "**Een server of VPS**: voer één regel uit in de terminal ervan en laat hem dan toe. De regel werkt één keer, 10 minuten lang.",
            ],
          },
          "De app maakt met één klik alleen verbinding met een adres met https, zoals een Tailscale-adres dat eindigt op `.ts.net`. Bij een gewoon http-adres gebruik je de regel voor de terminal.",
        ],
      },
      {
        id: "phones",
        heading: "Telefoons",
        blocks: [
          "Een Android-telefoon maakt verbinding via elke computer die al gekoppeld is: met een kabel, of via wifi vanaf Android 14 met de beveiligingsupdate van mei 2026. Een iPhone maakt verbinding via een Mac met de app en Xcode, en de app regelt de rest. Allebei begin je bij **Apparaat koppelen**.",
        ],
      },
      {
        id: "who",
        heading: "Wie hem mag gebruiken",
        blocks: [
          "Een nieuw apparaat is alleen voor jou: **Alleen ik** betekent jij en de agents die voor jou werken. Open het voor iedereen in de werkruimte, of voor bepaalde mensen en rollen, als je het toestaat of later op de pagina ervan in **Instellingen › Apparaten**.",
        ],
      },
      {
        id: "open",
        heading: "Zolang de app open is",
        blocks: [
          "Agents werken alleen op een computer zolang de app daar draait en de computer wakker is. Als de app het vraagt, laat **Klaar houden: agentes.chat openen bij inloggen** aangevinkt. Een computer die uit staat of slaapt, toont **Offline**, en agents wachten tot hij terug is.",
        ],
      },
      {
        id: "pausing",
        heading: "Pauzeren en loskoppelen",
        blocks: [
          "Op de computer pauzeert het agentes.chat-icoon bij de klok de agents van alle werkruimtes. In **Voorkeuren › Algemeen** pauzeert de schakelaar van elke werkruimte alleen die ene, en **Verlaten** koppelt hem los. Tijdens een pauze start er niets nieuws, en wat al liep, maakt het af. Na het loskoppelen blijven de mappen van de agents op de schijf staan.",
          "Op de website koppel je een apparaat los met **Verwijderen** op de pagina ervan.",
        ],
      },
      {
        id: "organizations",
        heading: "Meerdere werkruimtes, één computer",
        blocks: [
          "Meld je in dezelfde app aan bij elke werkruimte en druk voor elk op **Toestaan**. Werkruimtes op agentes.chat Cloud en op je eigen servers kunnen een computer delen (app 0.6.1 en nieuwer). Elk heeft er eigen agents en mappen, en als je er een loskoppelt, blijven de andere ongemoeid.",
          "Een server die de app op deze computer draait, is al gekoppeld en heeft niets nodig. Om die computer ook uit te lenen aan een werkruimte ergens anders, zie [Leen hem ook uit aan een andere werkruimte](/help/run-on-your-computer#another-workspace).",
          "Gebruik je de app op een laptop alleen als venster op je werkruimte? Als hij vraagt of agents de laptop mogen gebruiken, houdt **Niet nu** het bij een gewoon venster.",
        ],
      },
      {
        id: "folders",
        heading: "Mappen",
        blocks: [
          "Elke agent heeft altijd een eigen map, in `~/agentes/<workspace>`. Meer mappen geef je vrij op de computer zelf, nooit via de website: in de app via **Voorkeuren › Mappen**, of met `agentes-runner folders allow` op een server. Elke werkruimte geeft zijn eigen mappen vrij: wat je voor de ene vrijgeeft, geldt alleen voor de agents daarvan. Een map weghalen verwijdert niets. Het neemt alleen de toegang weg.",
        ],
      },
      {
        id: "reach",
        heading: "Waar agents bij kunnen",
        blocks: [
          "Agents draaien als jij, de gebruiker van de computer. Hun bestandstools blijven in hun mappen, maar een opdracht kan alles lezen wat jij kunt lezen:",
          {
            list: [
              "je bestanden en logins",
              "de mappen van andere agents, ook die van andere werkruimtes, en de logins die hun browsers bewaren",
              "het token dat deze computer koppelt",
              "op een computer die ook agentes.chat draait, de database en sleutels ervan in `.agentes`",
            ],
          },
          "agentes.chat weigert opdrachten die zijn sleutels, tokens en aanmeldingen noemen, maar dat is een regel, geen muur. **Opdrachten** staan standaard aan. Zet ze uit in de vraag van de app voordat je op **Toestaan** drukt, of later in **Voorkeuren\u00a0›\u00a0Tools**, waar één schakelaar voor alle werkruimtes op de computer geldt. Claude Code en Codex voeren hun eigen opdrachten uit in de map van de agent, volgens hun eigen regels.",
          "Voor een echte muur gebruik je een Linux-server. Op Debian 13, geïnstalleerd met `--system`, is elke agent een eigen gebruiker. Op Ubuntu delen agents één gebruiker, `agentes`: ze zien elkaars mappen, niet die van jou of van de server. Of geef de agents een eigen computer.",
        ],
      },
    ],
  },
  import: {
    title: "Je agents meenemen",
    summary:
      "Neem agents mee uit een andere app, of uit een andere agentes.chat-werkruimte, met hun instructies, skills, routines en geheugen.",
    sections: [
      {
        id: "comes",
        heading: "Wat er meekomt",
        blocks: [
          {
            list: [
              "Agents, met hun naam, rol, instructies en uiterlijk.",
              "Skills, aan voor de agents die ze hadden.",
              "Openbare kanalen, met de agents erin.",
              "Routines, actief en volgens hun schema. Pauzeer ze in **Routines** als je wilt.",
              "Geheugen: wat elke agent onthoudt.",
              "De eigen bestanden van elke agent (de bestandenmap van OpenBot.run, een OpenClaw-werkruimte), in een map met zijn naam in de **Drive**. Sleutels, logins en systeembestanden blijven achter, en niets wat er al staat wordt vervangen.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "Wat nooit meekomt",
        blocks: [
          "Sleutels, wachtwoorden, logins en chatgeschiedenis komen nooit mee: de agents denken met de AI van de werkruimte. Sommige dingen hebben hier nog geen tegenhanger, of horen nooit in een bestand te reizen. Je kunt ze later opnieuw aanmaken.",
          "Bestanden en mappen worden in je browser gelezen. Een GitHub-link gaat via de server van de werkruimte. Sleutel- en loginbestanden worden nooit geopend, en er verandert niets tot je bevestigt.",
        ],
      },
      {
        id: "other-apps",
        heading: "Uit een andere app",
        blocks: [
          "Kies **Grok Bot**, **ChatGPT dots** of **Een andere app**. Kopieer het verzoek, plak het in die app en breng terug wat die teruggeeft: sleep het bestand erin, of plak het hele antwoord. Waar elke app het neerzet:",
          {
            list: [
              "**Grok Bot**: in de chat met je bot. Hij antwoordt met de JSON: kopieer het hele antwoord.",
              "**ChatGPT dots**: in een nieuwe chat. Download het bestand dat hij maakt.",
              "**Claude**: in een nieuw gesprek, of in het project van je agents. Download het bestand dat hij maakt.",
              "**Manus**: in een nieuwe taak. Het bestand staat in de resultaten van de taak.",
              "**Rakazo**: stuur het naar je agent. Hij antwoordt met de JSON: kopieer het hele antwoord.",
              "**OpenBot**: geen verzoek nodig. Sleep de tenantmap (agents.yaml, agents/, model.yaml, skills.yaml) erin of plak de GitHub-link ervan.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "Een werkruimte exporteren",
        blocks: [
          "**Instellingen › Importeren en exporteren › Exporteren** downloadt een .json-bestand, om je agents mee te nemen naar een andere werkruimte of om een kopie te bewaren. In het bestand:",
          {
            list: [
              "Agents, met hun instructies, model en uiterlijk",
              "Skills, met de hele SKILL.md",
              "Openbare kanalen, met hun agents",
              "Geplande routines (ze komen actief aan de andere kant aan)",
              "Het geheugen dat iedereen in de werkruimte kan zien",
            ],
          },
          "Nooit erin:",
          {
            list: [
              "API-sleutels en wachtwoorden",
              "Connectors en logins",
              "Computers",
              "Gesprekken, berichten en privékanalen",
              "Gebruik, kosten en activiteitengeschiedenis",
            ],
          },
          "Om het bestand te gebruiken, open je **Instellingen › Importeren en exporteren** in de andere werkruimte en sleep je de .json erin.",
        ],
      },
    ],
  },
  wiki: {
    title: "De wiki",
    summary: "Wat het bedrijf weet, in pagina's die naar elkaar linken.",
    sections: [
      {
        id: "links",
        heading: "Links",
        blocks: [
          "Typ [[ om naar een andere pagina te linken. Backlinks en de graaf laten zien hoe pagina's samenhangen.",
        ],
      },
      {
        id: "agents",
        heading: "Hoe agents hem gebruiken",
        blocks: ["Agents lezen de wiki als ze antwoorden. Ze schrijven er alleen in als iemand daarom vraagt."],
      },
      {
        id: "obsidian",
        heading: "Een Obsidian-vault meenemen",
        blocks: [
          "Sleep de map van de vault, of een .zip ervan, in de stap Context van de setup of in de eigen import van de wiki. [[Links]], [[notitie|alias]] en [[notitie#sectie]] blijven werken. Tags komen uit de frontmatter en de tekst. Bijlagen gaan naar de Drive, en ingesloten afbeeldingen en bestanden worden kaarten op de pagina. Callouts blijven callouts. Dataview-query's komen binnen als tekst: vraag een agent om de tabel te bouwen. Canvassen en de instellingen van Obsidian (.obsidian) blijven buiten.",
        ],
      },
    ],
  },
  memory: {
    title: "Geheugen",
    summary: "Wat elke agent leert van gesprekken en van de correcties van het team.",
    sections: [
      {
        id: "learns",
        heading: "Hoe agents leren",
        blocks: [
          "Agents leren van gesprekken en van de correcties van het team. Wat een agent weet, komt in zijn context als het relevant is. Op het tabblad **Geheugen** bewerk, pin of archiveer je wat niet klopt of verouderd is.",
        ],
      },
      {
        id: "permissions",
        heading: "Geheugen geeft geen toestemming",
        blocks: [
          "Niets in het geheugen laat een agent meer doen. Wat hij mag, blijft in zijn **Tools en toegang**, en gevoelige acties vragen altijd om goedkeuring.",
        ],
      },
      {
        id: "proposals",
        heading: "Voorgestelde wijzigingen",
        blocks: [
          "Als een les terugkomt, kan de agent voorstellen zijn eigen instructies of de context van de werkruimte aan te passen. Er verandert niets tot iemand het accepteert, en de tekst kan eerst worden bijgewerkt. De vorige versie blijft in de geschiedenis. Een geweigerd voorstel wordt bewaard als les, zodat het niet opnieuw wordt voorgesteld.",
        ],
      },
    ],
  },
  approvals: {
    title: "Goedkeuringen",
    summary: "Gevoelige acties wachten op een mens, één keer of voorgoed.",
    sections: [
      {
        id: "what",
        heading: "Wat eerst vraagt",
        blocks: [
          "Als een agent wil mergen, deployen, terugdraaien, iets naar buiten sturen of gegevens verwijderen, vraagt hij het eerst, welke toegang hij ook heeft. Het verzoek verschijnt in **Goedkeuringen** en in het gesprek, met de precieze actie en de reden.",
        ],
      },
      {
        id: "always",
        heading: "Eén keer, of altijd",
        blocks: [
          "Goedkeuren geldt voor één precieze actie, met haar waarden. Verandert de agent iets, dan vraagt hij het opnieuw.",
          "**Altijd goedkeuren** laat de agent dat soort actie vanaf nu doen, met elke waarde, zonder te vragen. Bij het verzoek van een routine doet **Altijd in deze routine** hetzelfde, alleen voor die routine. Geen van beide wordt aangeboden voor mergen, deployen, terugdraaien en dergelijke. Ongedaan maken doe je in **Tools en toegang** op de pagina van de agent, of in de instellingen van de routine.",
        ],
      },
      {
        id: "who",
        heading: "Wie goedkeurt",
        blocks: [
          {
            list: [
              "De eigenaar van de agent, voor zijn verzoeken.",
              "Iedereen met een rol met **Acties van agents goedkeuren**, voor elke agent.",
              "De mensen die een agent noemt als hij vraagt, in plaats van zijn eigenaar.",
              "Wie iemand vervangt in **Wie keurt voor mij goed**, voor wat aan die persoon wordt gevraagd. Mergen, deployen en andere risicovolle acties alleen als dat aanstaat.",
            ],
          },
          "Een actie in iemands eigen mailbox wacht alleen op die persoon. Nieuwe toegang voor een agent wacht op wie agents beheert.",
          "Lodi, je rechterhand, kan ook voor jou nieuwe agents goedkeuren die andere agents voorstellen, en wijzigingen in het model, budget en de kanalen van een agent, alleen als jij erom vroeg. Wie jou vervangt en wat Lodi goedkeurt, kies je in **Instellingen\u00a0›\u00a0Jij\u00a0›\u00a0Goedkeuringen**.",
        ],
      },
      {
        id: "refusing",
        heading: "Weigeren",
        blocks: ["Zeg waarom, als je wilt: de agent leest het, past zijn plan aan en bewaart het als les."],
      },
      {
        id: "meetings",
        heading: "Afspraken",
        blocks: ["Agents stellen alleen tijden voor. Uitnodigingen aan mensen gaan altijd via degene die erom vroeg."],
      },
    ],
  },
  "who-answers": {
    title: "Wie een bericht beantwoordt",
    summary: "Een vermelding kiest de agent. Zonder vermelding kiest agentes.chat voor je, in deze volgorde.",
    sections: [
      {
        id: "order",
        heading: "Hoe een bericht zijn agent vindt",
        blocks: [
          "Een bericht dat een agent @vermeldt, gaat naar die agent. Een bericht zonder vermelding wordt gelezen door de eerste van deze die de werkruimte heeft:",
          {
            list: [
              "**Jev**, een klein, snel model gemaakt voor beslissingen zoals deze.",
              "**Een klein model op een van de API-sleutels van de werkruimte**, zoals Claude Haiku 5.5 of GPT-6 Luna.",
              "**Je eigen Claude- of ChatGPT-abonnement**, voor de berichten die jij schrijft, op een server die je zelf beheert. Het leest ze op de computer waar het is ingelogd, en dat duurt een paar seconden.",
              "**Eenvoudige regels**: een antwoord aan een agent gaat naar die agent, net als een vervolgbericht vlak nadat je met hem sprak, of een bericht in een kanaal waar je alleen bent met één agent.",
            ],
          },
          "Past geen van deze, dan antwoordt er geen agent. Vermeld een agent om hem op te roepen.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "Als agentes.chat je werkruimte host, zit Jev erbij inbegrepen. Op een server die je zelf beheert, gebruikt hij de TypeSafe-sleutel van de eigenaar, ongeveer US$ 0,0001 per bericht: [Jev instellen](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "Waarom je abonnement alleen voor jouw berichten kiest",
        blocks: [
          "Abonnementen van Claude en ChatGPT zijn persoonlijk, dus je abonnement kiest alleen voor de berichten die jij schrijft.",
        ],
      },
      {
        id: "see",
        heading: "Zien wie er koos",
        blocks: ["Open het vinkje onder een bericht. De laatste regel zegt wie de agents koos."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "Een snel model van TypeSafe dat snelle beslissingen neemt voor je agents. Op je eigen server is het optioneel, met een eigen sleutel.",
    sections: [
      {
        id: "what",
        heading: "Wat het doet",
        blocks: [
          {
            list: [
              "**Kiest wie antwoordt.** Een bericht waarin niemand is @vermeld, gaat in minder dan een seconde naar de juiste agent, ook als je agents denken met een abonnement en je geen API-sleutel hebt.",
              "**Houdt het geheugen netjes.** Het herkent een herhaling of een nieuwer feit, ook in andere woorden: de herhaling gaat op in wat de agent al wist, en het nieuwere feit vervangt het oude. Eén keer per dag ruimt het de rest op.",
              "**Ziet het scherm.** In hun browser en op hun bureaublad vinden agents knoppen en velden aan de hand van een beschrijving, kijken ze beter naar kleine, en controleren ze op de afbeelding van het scherm of een stap gelukt is.",
              "**Leest minder.** Elke beurt laadt alleen de tools die de agent waarschijnlijk nodig heeft, zodat je AI minder leest en minder kost.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Zonder Jev",
        blocks: [
          "Alles blijft werken, alleen trager en minder zorgvuldig.",
          {
            list: [
              "**Wie antwoordt:** een klein model op een van je API-sleutels kiest, zoals Claude Haiku 5.5 of GPT-6 Luna. Zonder sleutel kiest het eigen Claude- of ChatGPT-abonnement van elke persoon voor de berichten die die persoon schrijft, in een paar seconden. Anders komt een antwoord of een vervolgbericht nog steeds bij zijn agent aan. Vermeld een agent om hem op te roepen. [Hoe agents worden gekozen](/help/who-answers)",
              "**Geheugen:** herhalingen in dezelfde woorden worden nog steeds samengevoegd. Herhalingen en updates in andere woorden blijven apart.",
              "**Scherm:** agents gebruiken de nummers op het scherm en exacte namen. Er wordt niets uit afbeeldingen gelezen.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "Instellen",
        blocks: [
          {
            list: [
              "Open https://console.typesafe.ai en log in met Google of je e-mailadres. Een nieuw account maak je op dezelfde manier.",
              "Zet tegoed in de console. Jev is prepaid.",
              "Open https://console.typesafe.ai/keys, maak een sleutel aan en kopieer hem meteen.",
              "Open in agentes.chat **Instellingen › AI en gebruik** en plak hem onder **Jev**. Alleen degene die deze server heeft ingericht, ziet hem.",
            ],
          },
          "Op een server die je met Docker draait, kun je de sleutel ook in `.env` zetten als `TYPESAFE_API_KEY`. Die gaat voor op de sleutel in Instellingen.",
        ],
      },
      {
        id: "cost",
        heading: "Wat het kost",
        blocks: [
          {
            list: [
              "US$ 0,042 per miljoen tokens die Jev leest. Zijn antwoorden zijn gratis. Kiezen wie antwoordt leest ongeveer 2.500 tokens, dus ongeveer US$ 0,0001. Een screenshot is ongeveer 3.900 tokens.",
              "Tegoed dat je koopt, blijft 12 maanden geldig. Zet automatisch opwaarderen aan in de console, zodat Jev niet zonder komt te zitten.",
              "**Instellingen › AI en gebruik** laat zien hoeveel beslissingen Jev deze maand nam, en wat ze kostten.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "Je gegevens",
        blocks: [
          "Wat Jev leest om te beslissen:",
          {
            list: [
              "De naam en beschrijving van het kanaal, het bericht en de paar berichten ervoor",
              "De namen en rollen van je agents, het begin van hun instructies en de tools die ze kunnen gebruiken",
              "De geheugenitems die het vergelijkt",
              "De taak van een agent en het begin van de resultaten van zijn tools",
              "Het doel van een missie en de opdrachten die een agent ervoor wil uitvoeren",
              "De tools die een gekoppelde app aanbiedt",
              "De pagina of het scherm dat een agent gebruikt, schermafbeeldingen inbegrepen",
            ],
          },
          "TypeSafe draait Jev in de Verenigde Staten en traint zijn modellen niet op wat je stuurt. Het bewaart gegevens zo lang als nodig is om de dienst te leveren. Met de enterprise-abonnementen kun je ervoor kiezen dat er niets wordt bewaard.",
          "Het privacybeleid van TypeSafe: https://typesafe.ai/legal/privacy-policy. De verwerkersovereenkomst: https://typesafe.ai/legal/data-processing.",
        ],
      },
      {
        id: "problems",
        heading: "Als het stopt",
        blocks: [
          {
            list: [
              "**Sleutel niet geaccepteerd:** maak een nieuwe sleutel aan en plak hem in **Instellingen › AI en gebruik**.",
              "**Tegoed op:** zet tegoed in de console. Jev probeert het binnen 30 minuten opnieuw, of klik op **Opnieuw controleren**.",
              "**Druk of onbereikbaar:** TypeSafe kan het aantal verzoeken per seconde beperken, of een tijdje niet antwoorden. Jev pakt het vanzelf weer op. Je limieten: https://console.typesafe.ai/rate-limits. Voor hogere limieten schrijf je naar sales@typesafe.ai.",
            ],
          },
          "Intussen werken agents zoals in [Zonder Jev](/help/jev#without).",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "AI-apps",
    summary:
      "Vraag de agents van agentes.chat om taken vanuit Claude, Cursor of een andere MCP-app, zonder die te verlaten, en krijg het antwoord daar.",
    sections: [
      {
        id: "what",
        heading: "Hoe het werkt",
        blocks: [
          "agentes.chat is een MCP-server. Je plakt het adres in je AI-app, logt in met je account en kiest een werkruimte. Vanaf dan kan de app agents en kanalen tonen, namens jou een taak naar een agent sturen, op het antwoord wachten en recente taken lezen.",
          "Bijvoorbeeld midden in een scène in Unity of Blender vraag je Claude: ‘Vraag de marketingagent om een tekstje voor de lancering’. Het bericht verschijnt in agentes.chat als het jouwe, gemarkeerd met **via Claude**, en het antwoord van de agent komt terug in Claude.",
          "Het adres staat in **Instellingen › AI-apps**. Het eindigt op `/mcp`.",
        ],
      },
      {
        id: "connect",
        heading: "Een app koppelen",
        blocks: [
          {
            list: [
              "**Claude** (claude.ai, Claude Desktop en telefoon): klik in **Customize › Connectors** op **+ Add** en dan op **Add custom connector**, noem hem agentes.chat, plak het adres en klik op **Continue**. Kies **Sign in now**, klik op **Add** en geef toestemming. In de abonnementen Team en Enterprise voegt de Owner van de Claude-organisatie de connector toe in Organization settings › Connectors, en klikt elke persoon op **Connect** in Customize › Connectors. Het gratis abonnement van Claude heeft ruimte voor één eigen connector.",
              "**Claude Code:** voer `claude mcp add --transport http --scope user agentes <address>` uit, typ dan `/mcp`, kies agentes en **Authenticate**. Alleen voor de huidige map laat je `--scope user` weg.",
              "**Cursor:** **Toevoegen aan Cursor** in **Instellingen › AI-apps**, of het adres in `~/.cursor/mcp.json`. Cursor vraagt je in te loggen als je hem voor het eerst gebruikt.",
              '**VS Code:** **Toevoegen aan VS Code**, of het adres in `.vscode/mcp.json` met `"type": "http"`.',
              "**Andere apps:** ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains en meer hebben elk hun eigen stappen in **App koppelen**, met je adres al ingevuld.",
            ],
          },
          "Bij het inloggen laat agentes.chat zien welke app om toegang vroeg en waar hij naar terugkeert. Ga alleen verder als je de koppeling net zelf bent gestart.",
        ],
      },
      {
        id: "tools",
        heading: "Wat de app kan",
        blocks: [
          {
            list: [
              "`send_to_agent`: stuurt een bericht van jou naar een agent, in je privégesprek met hem of in een kanaal, en wacht op het antwoord. Alleen met toegang **Lezen en taken naar agents sturen**.",
              "`wait_for_reply`: blijft wachten op het antwoord op een taak.",
              "`list_agents`: de agents die jij ziet.",
              "`list_channels`: de kanalen die jij leest.",
              "`read_conversation`: recente berichten van een kanaal, een thread of een taak.",
              "`list_recent_tasks`: de taken die je vanuit apps stuurde en waar agents nu mee bezig zijn.",
            ],
          },
          "De app handelt namens jou en ziet alleen wat jij ziet. Hij keurt nooit acties van agents goed: als een agent stopt om goedkeuring te vragen, zegt het antwoord dat met een link, en beslist een mens in agentes.chat. Hij verandert ook geen instellingen, leden of rechten.",
        ],
      },
      {
        id: "workspace",
        heading: "Eén werkruimte per koppeling",
        blocks: [
          "Elke koppeling geldt voor de werkruimte die je bij het inloggen koos. Wil je een andere werkruimte gebruiken, koppel de app dan opnieuw en kies de andere.",
          "In **Instellingen › AI-apps** zie je de gekoppelde apps en wanneer elke app is gebruikt, en kun je ze ontkoppelen. Wie leden beheert, ziet de apps van de hele werkruimte en kan ze ook ontkoppelen. Elk bericht dat vanuit een app wordt gestuurd, staat in de audit.",
        ],
      },
      {
        id: "tokens",
        heading: "Persoonlijke tokens",
        blocks: [
          "Voor scripts en apps zonder inloggen via OAuth maak je een persoonlijk token aan in **Instellingen › AI-apps** en stuur je het mee in de header `Authorization: Bearer`. Het token wordt één keer getoond, werkt alleen in de werkruimte waarin het is aangemaakt, en kan verlopen na 30 dagen, 90 dagen, 1 jaar of nooit.",
          "Op een server zonder https, buiten de eigen computer, gebruik je een persoonlijk token: inloggen via OAuth vereist https.",
        ],
      },
      {
        id: "limits",
        heading: "Limieten",
        blocks: [
          {
            list: [
              "Tot 120 verzoeken per minuut en 5.000 per dag per koppeling.",
              "Tot 20 berichten per minuut en 500 per dag per persoon in elke werkruimte.",
              "Wachten duurt maximaal 45 seconden. Is de agent nog bezig, dan wacht de app opnieuw.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "Tekst van anderen",
        blocks: [
          "Antwoorden bevatten tekst die agents en mensen in agentes.chat hebben geschreven. De app krijgt die tekst gemarkeerd als inhoud, niet als instructies, maar een tekst kan toch proberen de app iets anders te laten doen. Controleer wat je app gaat doen voordat je bevestigt.",
        ],
      },
      {
        id: "problems",
        heading: "Als koppelen niet lukt",
        blocks: [
          {
            list: [
              "**Verzoek verlopen:** de inlogpagina blijft 30 minuten geldig en werkt één keer. Ga terug naar de app en koppel opnieuw.",
              "**De app vraagt je opnieuw in te loggen:** de koppeling is verbroken, het wachtwoord is gewijzigd of je hebt de werkruimte verlaten. Log opnieuw in vanuit de app.",
              "**Cursor blijft hangen op een oude login:** sluit Cursor af, verwijder de map `~/.mcp-auth` en koppel opnieuw.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "agentes.chat op een server installeren",
    summary: "Draai agentes.chat op je eigen server, gratis, voor je hele team. Eén opdracht zet alles klaar.",
    sections: [
      {
        id: "choose",
        heading: "Welke opzet je kiest",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**: voor elk team, overal bereikbaar. Wij draaien het, werken het bij en maken back-ups. Elke werkruimte krijgt een eigen computer, waarop elke agent een eigen gebruiker is.",
              "**Je computer, met de app**: voor jou of een klein team, bereikbaar zolang die computer aanstaat. Een Mac mini die aan blijft, werkt goed. Je werkt het bij met één klik en maakt zelf back-ups. Agents draaien als jij op die computer.",
              "**Een server**: voor een groter team, altijd bereikbaar. Je werkt het bij met drie opdrachten, en het kan elke dag vanzelf een back-up maken. Op Debian 13 is elke agent een eigen gebruiker.",
            ],
          },
          "Van je computer naar een server: [Verhuizen naar een server](/help/run-on-your-computer#moving). Elk van de drie kan agents uit een andere meenemen met [Je agents meenemen](/help/import).",
        ],
      },
      {
        id: "need",
        heading: "Wat je nodig hebt",
        blocks: [
          {
            list: [
              "Een server of VPS met 64-bit Linux, op x64 of arm64. Voor een klein team zijn 2 CPU's, 4 GB geheugen en 20 GB schijf een goed begin. Op een Mac of een pc [draait de app agentes.chat](/help/run-on-your-computer) zonder Docker.",
              "Docker met Compose. Op Linux zet het installatieprogramma ze erop als ze ontbreken, nadat het heeft gevraagd.",
              "Een manier om erbij te komen: een gratis Tailscale-account (de standaard, privé, zonder domein en zonder open poort), of een domein dat naar de server wijst, met poort 80 en 443 open.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "Installeren",
        blocks: [
          "Voer op de server uit:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "Het installeert wat ontbreekt en stelt dan een paar vragen: hoe mensen erbij komen, e-mail, of deze server ook de computer van je agents is en of het anonieme gebruiksstatistieken stuurt. Enter neemt het voorgestelde antwoord. Het komt in `/opt/agentes` (`~/agentes` voor een gebruiker die Docker al kan gebruiken), en de eerste keer downloadt het ongeveer 2 GB.",
          "Aan het eind toont het het adres van je server en een QR-code voor je telefoon. Het opnieuw uitvoeren kan geen kwaad: je instellingen blijven, en alleen wat ontbreekt wordt aangevuld.",
          "Met Node.js 18 of nieuwer is `npx @agenteschat/setup` in een lege map dezelfde installatie. Zonder Node draait die vanuit de image van de app, in de huidige map, en eindigt met de opdrachten die de rest starten:",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "Hoe mensen erbij komen",
        blocks: [
          {
            list: [
              "**Tailscale**, de standaard: privé HTTPS op `https://agentes.<jouw-tailnet>.ts.net`, alleen voor apparaten in je Tailscale-netwerk. Zet vóór de installatie MagicDNS en HTTPS aan op https://console.tailscale.com/admin/dns en maak een auth key op https://console.tailscale.com/admin/settings/keys, waar de installatie om vraagt.",
              "**Een openbaar domein**: iedereen op internet kan het openen, bijvoorbeeld op `https://chat.example.com`. Laat het domein naar de server wijzen en open poort 80 en 443. De installatie haalt het certificaat op en vernieuwt het, en laat je je account maken voordat het domein online gaat.",
              "**Alleen deze machine**: `http://localhost:3000`, om het op je eigen computer te proberen.",
            ],
          },
          "Bij Tailscale verlaat de server je netwerk als zijn key verloopt, na 180 dagen. Om hem te houden, open je het menu **⋯** van de server op https://console.tailscale.com/admin/machines en kies je **Disable Key Expiry**.",
          "Webhooks die routines starten, en AI-apps die vanaf hun eigen servers bellen, hebben een openbaar adres nodig. Bij Tailscale opent Funnel hetzelfde adres voor internet: voeg Funnel toe aan het beleid van je tailnet op https://console.tailscale.com/admin/acls en zet `TAILSCALE_FUNNEL=true` in `.env`, voer daarna `docker compose up -d` uit.",
        ],
      },
      {
        id: "owner",
        heading: "Je account",
        blocks: [
          "Open het adres van je server en meld je aan: het eerste account wordt de eigenaar. Daarna gaat aanmelden dicht, en mensen komen erbij via een uitnodiging, vanuit **Instellingen\u00a0›\u00a0Leden en uitnodigingen**.",
          "Bij Tailscale hebben de mensen die je uitnodigt ook je tailnet nodig. Nodig ze eerst uit op https://console.tailscale.com/admin/users en daarna in agentes.chat.",
        ],
      },
      {
        id: "email",
        heading: "E-mail",
        blocks: [
          "Zonder e-mail schrijft agentes.chat elke e-mail in zijn log in plaats van hem te versturen, dus een uitnodigingslink kun je daar nog kopiëren. Wachtwoord herstellen blijft uit.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "De installatie neemt je eigen mailserver (SMTP) of een key voor een Resend-compatibele API, zoals MillionSend of Resend. E-mails komen van `ping@<domein van je server>`, tenzij je een andere afzender kiest, en dat domein moet geverifieerd zijn bij je e-mailprovider. Om het later in te stellen, voer je de installatie opnieuw uit.",
        ],
      },
      {
        id: "phone",
        heading: "Je telefoon",
        blocks: [
          {
            list: [
              "Bij Tailscale installeer je de Tailscale-app op je telefoon en log je in op dezelfde tailnet.",
              "Installeer de agentes.chat-app.",
              "Scan de QR-code die de installatie toonde, of die in **Instellingen\u00a0›\u00a0Je account\u00a0›\u00a0Openen op je telefoon**, die je ook meteen inlogt.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "De computers van je agents",
        blocks: [
          "De installatie kan van deze server ook de computer van je agents maken, waar ze opdrachten uitvoeren, een browser gebruiken en hun bestanden bewaren. Ze vraagt het, en stelt ja voor waar de server het goed kan. Op Debian 13 krijgt elke agent een eigen gebruiker, met een scherm. Op Ubuntu delen agents één gebruiker, `agentes`. Zei je nee, voer de installatie dan opnieuw uit met `--computer yes`:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "Meer computers, zoals een Mac met de agentes.chat-app of een andere server, koppel je via **Instellingen\u00a0›\u00a0Apparaten**, zoals in [Je computers en telefoons](/help/computers). Bij Tailscale komen ze eerst in je tailnet.",
        ],
      },
      {
        id: "backups",
        heading: "Back-ups en herstellen",
        blocks: [
          "Je server bestaat uit drie dingen: de database, de geüploade bestanden en `AGENTES_SECRET` in `.env`. Bewaar een kopie van `.env` op een veilige plek, los van de back-ups: zonder het secret zijn de keys in een herstelde database niet te lezen.",
          "Voor elke dag een back-up maak je een privé bucket op Cloudflare R2 of een andere S3-compatibele opslag, en een key die erin kan lezen, schrijven en verwijderen. Zet ze in `.env`, met `backup` in `COMPOSE_PROFILES` (`https,backup` met een openbaar domein):",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "Voer daarna `docker compose up -d` uit in de installatiemap. De database wordt om 03:00 UTC gedumpt en elke dump blijft 14 dagen. `docker compose run --rm backup now` maakt er meteen een, en `docker compose run --rm backup list` toont ze. De dumps bevatten alleen de database: de geüploade bestanden, in het volume `files`, hebben een eigen kopie nodig, en de volledige handleiding hieronder heeft de opdrachten.",
          "Om te herstellen haal je een dump op met `docker compose run --rm -T backup fetch <naam> > agentes.dump` en laad je die in een lege database, met de app gestopt:",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "Herstel in de versie die de dump maakte, of in een nieuwere.",
        ],
      },
      {
        id: "upgrades",
        heading: "Updates",
        blocks: [
          "Voer in de installatiemap uit:",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "De database werkt zichzelf bij als de nieuwe versie start. Houd je instellingen in `.env` en bewerk `docker-compose.yml` nooit, want elke update vervangt het. Maak een back-up vóór een grote sprong: een database die een nieuwere versie heeft bijgewerkt, opent niet in een oudere.",
        ],
      },
      {
        id: "data",
        heading: "Wat het verstuurt",
        blocks: [
          "Eén keer per dag stuurt de server agentes.chat anonieme gebruiksstatistieken: aantallen zoals mensen, agents, grootte van de machines, gebruikte AI-tokens en hoeveel data de browsers van de agents versturen en ontvangen. Nooit berichten, bestanden, namen of sites. `docker compose run --rm agentes telemetry` toont precies wat er verstuurd zou worden. De eigenaar zet het uit in **Instellingen\u00a0›\u00a0Algemeen**, of met `TELEMETRY=off` in `.env`.",
          "Foutrapporten gaan nergens heen, tenzij je `SENTRY_DSN` instelt op een Sentry-compatibele server die je zelf kiest. Een rapport bevat de fout en waar die gebeurde, nooit berichten, e-mails, IP-adressen, cookies of tokens.",
        ],
      },
      {
        id: "reference",
        heading: "De volledige handleiding",
        blocks: [
          "Alle instellingen, een eigen proxy zoals nginx, draaien zonder Docker, een draaiboek voor AI-agents die het zelf installeren en wat je doet als iets misgaat staan in `SELF_HOSTING.md`, in de repository van agentes.chat.",
        ],
      },
    ],
  },
};
