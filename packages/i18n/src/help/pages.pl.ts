import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

/** The help pages in pl: a page not here shows in English. */
export const helpPl: Partial<Record<HelpSlug, HelpDocument>> = {
  "run-on-your-computer": {
    title: "agentes.chat na twoim komputerze",
    summary:
      "Aplikacja agentes.chat może też uruchomić samo agentes.chat, na Macu, PC albo komputerze z Linuksem, dla ciebie lub małego zespołu.",
    sections: [
      {
        id: "how",
        heading: "Jak to działa",
        blocks: [
          "Działa wewnątrz aplikacji, z wbudowaną bazą danych, i trzyma wszystko w jednym folderze na tym komputerze: `.agentes` w twoim folderze domowym. Nie trzeba niczego więcej instalować: bez Dockera, bez konfigurowania bazy danych.",
          "Uruchamia się razem z aplikacją i zatrzymuje, gdy ją zamkniesz. Przed zamknięciem aplikacja pyta, bo nikt nie skorzysta z agentes.chat, dopóki znów jej nie otworzysz.",
        ],
      },
      {
        id: "who",
        heading: "Dla kogo to jest",
        blocks: [
          "Dla ciebie albo małego zespołu. Mac mini, zapasowy PC albo laptop, który zostaje włączony, to dobre miejsce: przygotuj go jak w [Niech zostaje włączony](#keep-on). Na Macu i PC aplikacja to sposób na uruchomienie agentes.chat bez Dockera.",
          "Dla większego zespołu zobacz [Którą konfigurację wybrać](/help/install-on-a-server#choose). Dane możesz później przenieść na serwer.",
        ],
      },
      {
        id: "keep-on",
        heading: "Niech zostaje włączony",
        blocks: [
          "Na komputerze, z którego korzystają inni, ustaw to raz:",
          {
            list: [
              "**Otwieraj po zalogowaniu** włącza się samo po konfiguracji.",
              "Na Macu włącz **Logowanie automatyczne** w **Ustawienia systemowe › Użytkownicy i grupy**, żeby aplikacja otwierała się po restarcie. FileVault wyłącza logowanie automatyczne.",
              "Na Macu włącz **Uruchamiaj automatycznie po awarii zasilania** w **Ustawienia systemowe › Energia**.",
              "Mac nie usypia, dopóki działa serwer i włączona jest opcja **Dostęp z telefonu i dla zespołu**. Na Windowsie i Linuksie wyłącz usypianie w ustawieniach zasilania systemu.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "Twoi agenci też tu pracują",
        blocks: [
          "Twoi agenci też pracują na tym komputerze, we własnych folderach, z przeglądarką oraz z Claude Code lub Codexem, jeśli są tu zainstalowane.",
          "Agenci działają tu jako ty. **Polecenia** są domyślnie włączone, a z nimi agenci każdej przestrzeni roboczej, która używa tego komputera, mają dostęp do wszystkiego na nim, także do danych serwera. Wyłączysz je w **Preferencje\u00a0›\u00a0Narzędzia**. Zobacz [Do czego mają dostęp agenci](/help/computers#reach).",
        ],
      },
      {
        id: "another-workspace",
        heading: "Udostępnij go też innej przestrzeni roboczej",
        blocks: [
          "Przestrzenie robocze serwera, który tu uruchamiasz, korzystają z tego komputera same. Żeby mogła z niego korzystać także przestrzeń robocza gdzie indziej, na przykład w agentes.chat Cloud, otwórz **Preferencje › Serwery**, naciśnij **Dodaj serwer…**, zaloguj się do tej przestrzeni roboczej i naciśnij **Zezwól**, gdy aplikacja zapyta.",
          "Każda przestrzeń robocza ma tu własnych agentów i foldery. **Polecenia** są dla niej też domyślnie włączone. Wyłącz je w pytaniu aplikacji, zanim naciśniesz **Zezwól**, albo później w **Preferencje\u00a0›\u00a0Narzędzia**, gdzie jeden przełącznik obowiązuje wszystkie przestrzenie robocze na tym komputerze.",
        ],
      },
      {
        id: "reach",
        heading: "Z telefonu i dla zespołu",
        blocks: [
          "**Dostęp z telefonu i dla zespołu** umieszcza agentes.chat w Tailscale, prywatnej sieci twoich urządzeń: dołączają do niej twój telefon i zaproszone osoby, a nikt inny nie dotrze do agentes.chat. Tailscale jest darmowy: https://tailscale.com/download. Gdy ta opcja jest wyłączona, agentes.chat działa tylko na tym komputerze.",
          "Jeśli ten komputer udostępnia już coś innego na porcie 443 Tailscale, agentes.chat bierze port 8443, a jego adres kończy się na `:8443`.",
        ],
      },
      {
        id: "password",
        heading: "Logowanie z innych urządzeń",
        blocks: [
          "Właściciel zaczyna bez hasła: aplikacja loguje cię na tym komputerze. Żeby zalogować się w przeglądarce na innym komputerze, ustaw hasło w **Ustawienia › Twoje konto**. Aplikacja na telefon łączy się po zeskanowaniu kodu QR z sekcji **Na telefonie**, w **Preferencje › Serwery**. Musi być przy tym włączone **Dostęp z telefonu i dla zespołu**.",
        ],
      },
      {
        id: "updates",
        heading: "Aktualizacje",
        blocks: [
          "Aplikacja sama szuka aktualizacji i instaluje je, gdy naciśniesz **Zaktualizuj i otwórz ponownie** w **Preferencje › Aktualizacje**. Serwer i wszyscy agenci uruchamiają się wtedy ponownie. Najpierw powstaje kopia bazy danych, a jeśli nowa wersja nie odpowie w ciągu 3 minut, aplikacja sama wraca do poprzedniej wersji i jej danych.",
        ],
      },
      {
        id: "backups",
        heading: "Kopie zapasowe",
        blocks: [
          "Na razie nic nie robi kopii samo. **Zrób kopię zapasową teraz**, w **Preferencje › Serwery**, zatrzymuje na chwilę serwer i zapisuje bazę danych, pliki i `.env` w `.agentes/backups`, w twoim folderze domowym. Zostają dwie najnowsze.",
          "Co jakiś czas skopiuj je poza ten komputer, na dysk albo do chmury. Zawierają twoje klucze: trzymaj je w tajemnicy.",
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code i Codex",
        blocks: [
          "Aplikacja znajduje Claude Code i Codex przez `PATH` twojej powłoki logowania oraz w typowych folderach, takich jak `~/.local/bin`, `/opt/homebrew/bin` i `/usr/local/bin`. Jeśli **Preferencje › Narzędzia** pokazuje **Nie znaleziono**, sprawdź, czy `claude` albo `codex` działa w nowym oknie Terminala, a potem zamknij i otwórz aplikację ponownie.",
        ],
      },
      {
        id: "moving",
        heading: "Przenosiny na serwer",
        blocks: [
          {
            list: ["Zamknij aplikację, a potem zrzuć bazę danych kopią serwera, którą ma aplikacja. Na Macu:"],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[Zainstaluj agentes.chat na serwerze](/help/install-on-a-server), ale jeszcze go nie uruchamiaj. W jego `.env` wpisz `AGENTES_SECRET` z `~/.agentes/.env`, a potem uruchom tylko bazę danych: `docker compose up -d postgres`.",
              "Wczytaj zrzut: `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "Uruchom go przez `docker compose up -d`, skopiuj do niego `~/.agentes/files`, jak pokazuje pełny przewodnik, i zaloguj się jak wcześniej.",
            ],
          },
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "Komputer przestrzeni roboczej",
    summary: "Każda przestrzeń robocza dostaje własny komputer, zawsze włączony, na którym pracują jej agenci.",
    sections: [
      {
        id: "what",
        heading: "Co to jest",
        blocks: [
          "Komputer tylko dla tej przestrzeni roboczej, zawsze włączony. Każdy agent ma na nim własnego użytkownika, z własnym folderem, ekranem, przeglądarką i plikami. Na stronie agenta możesz oglądać, jak pracuje, i przejąć kontrolę, gdy trzeba.",
        ],
      },
      {
        id: "own",
        heading: "Twoje własne komputery i telefony",
        blocks: [
          "Agenci mogą też pracować na komputerach i telefonach, które przyniesiesz: Macu albo PC z aplikacją agentes.chat, serwerze, telefonie z Androidem albo iPhonie. Zobacz [Twoje komputery i telefony](/help/computers).",
        ],
      },
      {
        id: "plans",
        heading: "Twoje plany AI",
        blocks: [
          "Twoi agenci mogą myśleć dzięki twojemu własnemu planowi AI, takiemu jak Claude, ChatGPT, GLM czy Kimi, zalogowanemu na tym komputerze: klucz API nie jest potrzebny. Konto zostaje na tym komputerze, a agentes.chat nigdy nie widzi hasła ani dostępu.",
          "Plany Google AI Pro i Ultra tu nie działają: warunki Google nie pozwalają używać ich w innych produktach. Klucz API Gemini działa.",
        ],
      },
      {
        id: "size",
        heading: "Jego parametry",
        blocks: ["Procesory, pamięć i dysk znajdziesz w **Ustawienia › Urządzenia**."],
      },
      {
        id: "trouble",
        heading: "Gdy przestaje odpowiadać",
        blocks: ["Zwykle wraca w ciągu kilku minut, a my już się tym zajmujemy: nie musisz nic robić."],
      },
    ],
  },
  computers: {
    title: "Twoje komputery i telefony",
    summary:
      "Przynieś Maca, PC, komputer z Linuksem, serwer albo telefon, a twoi agenci będą na nim pracować. Tak samo w agentes.chat Cloud, jak na własnym serwerze.",
    sections: [
      {
        id: "app",
        heading: "Z aplikacji agentes.chat",
        blocks: [
          "Zainstaluj aplikację na komputerze, otwórz ją i zaloguj się do swojej przestrzeni roboczej. Zapyta **Pozwolić agentom z <workspace> używać tego urządzenia (Mac)?** (PC na Windowsie, komputer na Linuksie). Wybierz, kto może z niego korzystać, i naciśnij **Zezwól**. To wszystko.",
          "Jesteś już zalogowany? Włącz przestrzeń roboczą w **Preferencje › Ogólne**, na karcie **Agenci**.",
        ],
      },
      {
        id: "web",
        heading: "Ze strony",
        blocks: [
          "W **Ustawienia › Urządzenia** naciśnij **Podłącz urządzenie**:",
          {
            list: [
              "**Ten Mac** albo **Ten PC**: otwiera aplikację, która najpierw zapyta.",
              "**Inny komputer**: zainstaluj tam aplikację, zaloguj się na swoje konto i naciśnij **Zezwól**. Pojawi się tu sam.",
              "**Serwer lub VPS**: uruchom jedną linię w jego terminalu, a potem pozwól mu dołączyć. Linia działa raz, przez 10 minut.",
            ],
          },
          "Aplikacja łączy się jednym kliknięciem tylko z adresem https, na przykład adresem Tailscale kończącym się na `.ts.net`. Przy zwykłym adresie http użyj linii do terminala.",
        ],
      },
      {
        id: "phones",
        heading: "Telefony",
        blocks: [
          "Telefon z Androidem łączy się przez dowolny już podłączony komputer: kablem albo przez Wi-Fi od Androida 14 z aktualizacją zabezpieczeń z maja 2026. iPhone łączy się przez Maca z aplikacją i Xcode, a resztę przygotuje aplikacja. Jedno i drugie zaczyna się od **Podłącz urządzenie**.",
        ],
      },
      {
        id: "who",
        heading: "Kto może z niego korzystać",
        blocks: [
          "Nowe urządzenie jest tylko dla ciebie: **Tylko ja** oznacza ciebie i agentów, którzy dla ciebie pracują. Otwórz je dla wszystkich w przestrzeni roboczej albo dla wybranych osób i ról, gdy na nie zezwalasz, albo później na jego stronie w **Ustawienia › Urządzenia**.",
        ],
      },
      {
        id: "open",
        heading: "Dopóki aplikacja jest otwarta",
        blocks: [
          "Agenci pracują na komputerze tylko wtedy, gdy działa na nim aplikacja, a komputer nie śpi. Gdy aplikacja zapyta, zostaw zaznaczone **Trzymaj w gotowości: otwieraj agentes.chat po zalogowaniu**. Komputer wyłączony albo uśpiony pokazuje **Offline**, a agenci czekają, aż wróci.",
        ],
      },
      {
        id: "pausing",
        heading: "Pauza i odłączanie",
        blocks: [
          "Na komputerze ikona agentes.chat przy zegarze wstrzymuje agentów wszystkich przestrzeni roboczych. W **Preferencje › Ogólne** przełącznik każdej przestrzeni roboczej wstrzymuje tylko ją, a **Odłącz** ją odłącza. Podczas pauzy nic nowego się nie zaczyna, a to, co już działało, kończy się. Po odłączeniu foldery agentów zostają na dysku.",
          "Na stronie internetowej urządzenie odłączysz przyciskiem **Usuń** na jego stronie.",
        ],
      },
      {
        id: "organizations",
        heading: "Kilka przestrzeni roboczych, jeden komputer",
        blocks: [
          "Zaloguj się do każdej przestrzeni roboczej w tej samej aplikacji i naciśnij **Zezwól** dla każdej z nich. Przestrzenie robocze w agentes.chat Cloud i na twoich własnych serwerach mogą dzielić jeden komputer (aplikacja 0.6.1 i nowsze). Każda ma na nim własnych agentów i foldery, a odłączenie jednej nie zmienia nic w pozostałych.",
          "Serwer, który aplikacja uruchamia na tym komputerze, jest już podłączony i nic więcej nie trzeba. Żeby udostępnić ten komputer także przestrzeni roboczej gdzie indziej, zobacz [Udostępnij go też innej przestrzeni roboczej](/help/run-on-your-computer#another-workspace).",
          "Używasz aplikacji na laptopie tylko jako okna do swojej przestrzeni roboczej? Gdy zapyta, czy agenci mogą używać laptopa, **Nie teraz** zostawi ją zwykłym oknem.",
        ],
      },
      {
        id: "folders",
        heading: "Foldery",
        blocks: [
          "Każdy agent zawsze ma własny folder w `~/agentes/<workspace>`. Na kolejne foldery można zezwolić tylko na samym komputerze, nigdy ze strony: w aplikacji w **Preferencje › Foldery** albo na serwerze poleceniem `agentes-runner folders allow`. Każda przestrzeń robocza ma własne dozwolone foldery: to, na co zezwolisz w jednej, dotyczy tylko jej agentów. Usunięcie folderu niczego nie kasuje. Odbiera tylko dostęp.",
        ],
      },
      {
        id: "reach",
        heading: "Do czego mają dostęp agenci",
        blocks: [
          "Agenci działają jako ty, użytkownik komputera. Ich narzędzia do plików zostają w ich folderach, ale polecenie może odczytać wszystko, co możesz odczytać ty:",
          {
            list: [
              "twoje pliki i dane logowania",
              "foldery innych agentów, także z innych przestrzeni roboczych, oraz logowania zapisane w ich przeglądarkach",
              "token, który łączy ten komputer",
              "na komputerze, który uruchamia też agentes.chat, jego bazę danych i klucze w `.agentes`",
            ],
          },
          "agentes.chat odrzuca polecenia, które wskazują jego klucze, tokeny i dane logowania, ale to zasada, nie mur. **Polecenia** są domyślnie włączone. Wyłącz je w pytaniu aplikacji, zanim naciśniesz **Zezwól**, albo później w **Preferencje\u00a0›\u00a0Narzędzia**, gdzie jeden przełącznik obowiązuje wszystkie przestrzenie robocze na komputerze. Claude Code i Codex uruchamiają własne polecenia w folderze agenta, według własnych zasad.",
          "Prawdziwy mur da ci serwer z Linuksem. Na Debianie 13, zainstalowanym z `--system`, każdy agent jest osobnym użytkownikiem. Na Ubuntu agenci dzielą jednego użytkownika, `agentes`: widzą nawzajem swoje foldery, ale nie twoje ani serwera. Możesz też dać agentom osobny komputer.",
        ],
      },
    ],
  },
  import: {
    title: "Przenieś swoich agentów",
    summary:
      "Przenieś agentów z innej aplikacji albo z innej przestrzeni roboczej agentes.chat, z ich instrukcjami, umiejętnościami, rutynami i pamięcią.",
    sections: [
      {
        id: "comes",
        heading: "Co zostaje przeniesione",
        blocks: [
          {
            list: [
              "Agenci, z nazwą, rolą, instrukcjami i wyglądem.",
              "Umiejętności, włączone dla agentów, którzy je mieli.",
              "Kanały publiczne, razem z agentami, którzy w nich są.",
              "Rutyny, aktywne i według swojego harmonogramu. Jeśli chcesz, wstrzymaj je w **Rutyny**.",
              "Pamięć: to, co pamięta każdy agent.",
              "Własne pliki każdego agenta (folder plików OpenBot.run, workspace OpenClaw), w folderze z jego nazwą na **Drive**. Klucze, loginy i pliki systemowe zostają, a nic, co już tam jest, nie zostanie zastąpione.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "Czego nigdy się nie przenosi",
        blocks: [
          "Klucze, hasła, loginy i historia czatów nigdy nie są przenoszone: agenci myślą dzięki AI przestrzeni roboczej. Niektóre rzeczy nie mają tu jeszcze odpowiednika albo nigdy nie powinny trafiać do pliku. Możesz je odtworzyć później.",
          "Pliki i foldery są odczytywane w twojej przeglądarce. Link do GitHub przechodzi przez serwer przestrzeni roboczej. Pliki z kluczami i loginami nigdy nie są otwierane, a nic się nie zmieni, dopóki nie potwierdzisz.",
        ],
      },
      {
        id: "other-apps",
        heading: "Z innej aplikacji",
        blocks: [
          "Wybierz **Grok Bot**, **ChatGPT dots** albo **Inna aplikacja**. Skopiuj prośbę, wklej ją w tamtej aplikacji, a potem przynieś to, co zwróci: upuść plik albo wklej całą odpowiedź. Gdzie wkleić ją w każdej aplikacji:",
          {
            list: [
              "**Grok Bot**: w czacie ze swoim botem. Odpowie plikiem JSON: skopiuj całą odpowiedź.",
              "**ChatGPT dots**: w nowym czacie. Pobierz plik, który utworzy.",
              "**Claude**: w nowej rozmowie albo w projekcie twoich agentów. Pobierz plik, który utworzy.",
              "**Manus**: w nowym zadaniu. Plik znajdziesz w wynikach zadania.",
              "**Rakazo**: wyślij ją swojemu agentowi. Odpowie plikiem JSON: skopiuj całą odpowiedź.",
              "**OpenBot**: prośba nie jest potrzebna. Przeciągnij folder najemcy (agents.yaml, agents/, model.yaml, skills.yaml) albo wklej link do niego na GitHub.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "Eksport przestrzeni roboczej",
        blocks: [
          "**Ustawienia › Import i eksport › Eksportuj** pobiera plik .json, żeby przenieść agentów do innej przestrzeni roboczej albo zachować kopię. W pliku są:",
          {
            list: [
              "Agenci, z instrukcjami, modelem i wyglądem",
              "Umiejętności, z całym plikiem SKILL.md",
              "Kanały publiczne, z ich agentami",
              "Zaplanowane rutyny (po drugiej stronie trafiają jako aktywne)",
              "Pamięć, którą widzą wszyscy w przestrzeni roboczej",
            ],
          },
          "Nigdy nie ma w nim:",
          {
            list: [
              "Kluczy API i haseł",
              "Konektorów i loginów",
              "Komputerów",
              "Rozmów, wiadomości i kanałów prywatnych",
              "Użycia, kosztów i historii aktywności",
            ],
          },
          "Żeby użyć pliku, otwórz **Ustawienia › Import i eksport** w drugiej przestrzeni roboczej i upuść plik .json.",
        ],
      },
    ],
  },
  wiki: {
    title: "Wiki",
    summary: "To, co wie firma, na stronach połączonych ze sobą.",
    sections: [
      {
        id: "links",
        heading: "Linki",
        blocks: ["Wpisz [[, żeby dodać link do innej strony. Linki zwrotne i graf pokazują, jak łączą się strony."],
      },
      {
        id: "agents",
        heading: "Jak korzystają z niej agenci",
        blocks: ["Agenci czytają wiki, gdy odpowiadają. Piszą w niej tylko wtedy, gdy ktoś o to poprosi."],
      },
      {
        id: "obsidian",
        heading: "Przenieś sejf Obsidian",
        blocks: [
          "Upuść folder sejfu albo jego plik .zip w kroku Kontekst podczas konfiguracji albo w imporcie samej wiki. [[Linki]], [[notatka|alias]] i [[notatka#sekcja]] dalej działają. Tagi są brane z frontmattera i z tekstu. Załączniki trafiają na Drive, a osadzone obrazy i pliki stają się kartami na stronie. Bloki wyróżnień zostają blokami wyróżnień. Zapytania Dataview trafiają jako tekst: poproś agenta, żeby zbudował tabelę. Kanwy i ustawienia Obsidiana (.obsidian) nie są przenoszone.",
        ],
      },
    ],
  },
  memory: {
    title: "Pamięć",
    summary: "To, czego każdy agent uczy się z rozmów i poprawek zespołu.",
    sections: [
      {
        id: "learns",
        heading: "Jak uczą się agenci",
        blocks: [
          "Agenci uczą się z rozmów i z poprawek zespołu. To, co agent wie, trafia do jego kontekstu, gdy ma znaczenie. Na karcie **Pamięć** edytuj, przypnij albo zarchiwizuj to, co jest błędne lub nieaktualne.",
        ],
      },
      {
        id: "permissions",
        heading: "Pamięć nie daje uprawnień",
        blocks: [
          "Nic w pamięci nie pozwala agentowi zrobić więcej. To, co może robić, określają jego **Narzędzia i dostęp**, a działania wrażliwe zawsze wymagają zatwierdzenia.",
        ],
      },
      {
        id: "proposals",
        heading: "Proponowane zmiany",
        blocks: [
          "Gdy jakaś lekcja się powtarza, agent może zaproponować zmianę własnych instrukcji albo kontekstu przestrzeni roboczej. Nic się nie zmieni, dopóki ktoś tego nie zaakceptuje, a tekst można najpierw poprawić. Poprzednia wersja zostaje w historii. Odrzucona propozycja zostaje zapamiętana jako lekcja, więc nie wróci.",
        ],
      },
    ],
  },
  approvals: {
    title: "Zatwierdzenia",
    summary: "Wrażliwe działania czekają na człowieka, raz albo na stałe.",
    sections: [
      {
        id: "what",
        heading: "Co wymaga zatwierdzenia",
        blocks: [
          "Gdy agent chce scalić zmiany, wdrożyć, wycofać wdrożenie, wysłać coś na zewnątrz albo usunąć dane, najpierw pyta, bez względu na to, jaki ma dostęp. Prośba pojawia się w **Zatwierdzenia** i w rozmowie, z dokładnym działaniem i powodem.",
        ],
      },
      {
        id: "always",
        heading: "Raz albo zawsze",
        blocks: [
          "Zatwierdzenie obejmuje jedno konkretne działanie, z jego wartościami. Jeśli agent cokolwiek zmieni, pyta ponownie.",
          "**Zawsze zatwierdzaj** pozwala agentowi od teraz robić ten rodzaj działań z dowolnymi wartościami, bez pytania. Przy prośbie z rutyny **Zawsze w tej rutynie** robi to samo tylko dla tej rutyny. Żadna z tych opcji nie pojawia się przy scalaniu, wdrażaniu, wycofywaniu i podobnych. Aby to cofnąć, przejdź do **Narzędzia i dostęp** na stronie agenta albo do ustawień rutyny.",
        ],
      },
      {
        id: "who",
        heading: "Kto zatwierdza",
        blocks: [
          {
            list: [
              "Właściciel agenta, w jego prośbach.",
              "Każdy, czyja rola ma **Zatwierdzanie działań agentów**, we wszystkich agentach.",
              "Osoby, które agent wskaże, prosząc, zamiast właściciela.",
              "Ktoś, kto zastępuje inną osobę w **Kto zatwierdza za mnie**, w tym, o co ta osoba jest proszona. Scalanie, wdrażanie i inne ryzykowne działania tylko wtedy, gdy to jest włączone.",
            ],
          },
          "Działanie we własnej skrzynce pocztowej kogoś czeka tylko na tę osobę. Nowy dostęp dla agenta czeka na tych, którzy zarządzają agentami.",
          "Lodi, twoja prawa ręka, może też zatwierdzać za ciebie nowych agentów proponowanych przez innych agentów oraz zmiany modelu, budżetu i kanałów agenta, tylko gdy prośba wyszła od ciebie. Kto cię zastępuje i co zatwierdza Lodi, wybierasz w **Ustawienia\u00a0›\u00a0Ty\u00a0›\u00a0Zatwierdzenia**.",
        ],
      },
      {
        id: "refusing",
        heading: "Odrzucanie",
        blocks: ["Jeśli chcesz, napisz dlaczego: agent to przeczyta, dostosuje plan i zapamięta to jako lekcję."],
      },
      {
        id: "meetings",
        heading: "Spotkania",
        blocks: ["Agenci tylko proponują terminy. Zaproszenia dla ludzi zawsze wysyła osoba, która o nie poprosiła."],
      },
    ],
  },
  "who-answers": {
    title: "Kto odpowiada na wiadomość",
    summary: "Wzmianka wybiera agenta. Bez niej agentes.chat wybiera za ciebie, w tej kolejności.",
    sections: [
      {
        id: "order",
        heading: "Jak wiadomość trafia do agenta",
        blocks: [
          "Wiadomość, która @wspomina agenta, trafia do tego agenta. Wiadomość bez wzmianki czyta pierwsza z tych opcji, jaką ma przestrzeń robocza:",
          {
            list: [
              "**Jev**, mały, szybki model stworzony do takich decyzji.",
              "**Mały model na jednym z kluczy API przestrzeni roboczej**, na przykład Claude Haiku 5.5 albo GPT-6 Luna.",
              "**Twój własny plan Claude lub ChatGPT**, dla wiadomości, które piszesz, na serwerze, który prowadzisz samodzielnie. Czyta je na komputerze, na którym jest zalogowany, i zajmuje to kilka sekund.",
              "**Proste reguły**: odpowiedź agentowi trafia do niego, tak samo jak kolejna wiadomość zaraz po rozmowie z nim albo wiadomość na kanale, na którym poza tobą jest tylko jeden agent.",
            ],
          },
          "Gdy żadna z tych opcji nie pasuje, nie odpowiada żaden agent. Wspomnij agenta, żeby go zawołać.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "Gdy twoja przestrzeń robocza działa na agentes.chat, Jev jest w cenie. Na serwerze, który prowadzisz samodzielnie, używa klucza TypeSafe właściciela, około 0,0001 USD za wiadomość: [Skonfiguruj Jeva](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "Dlaczego twój plan wybiera tylko dla twoich wiadomości",
        blocks: ["Plany Claude i ChatGPT są osobiste, więc twój plan wybiera tylko dla wiadomości, które piszesz ty."],
      },
      {
        id: "see",
        heading: "Kto wybrał",
        blocks: ["Otwórz znacznik pod wiadomością. Ostatni wiersz mówi, kto wybrał agentów."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "Szybki model od TypeSafe, który podejmuje drobne decyzje za twoich agentów. Na własnym serwerze jest opcjonalny, z twoim własnym kluczem.",
    sections: [
      {
        id: "what",
        heading: "Co robi",
        blocks: [
          {
            list: [
              "**Wybiera, kto odpowiada.** Wiadomość bez @wzmianki trafia do właściwego agenta w niecałą sekundę, nawet gdy twoi agenci myślą dzięki planowi i nie masz klucza API.",
              "**Utrzymuje porządek w pamięci.** Wychwytuje powtórzenie albo nowszy fakt, nawet zapisane innymi słowami: powtórzenie łączy się z tym, co agent już wiedział, a nowszy fakt zastępuje stary. Raz dziennie porządkuje resztę.",
              "**Widzi ekran.** W przeglądarce i na pulpicie agenci znajdują przyciski i pola na podstawie opisu, przyglądają się z bliska tym małym i sprawdzają na obrazie ekranu, czy krok się udał.",
              "**Czyta mniej.** Każda tura wczytuje tylko narzędzia, których agent prawdopodobnie użyje, więc twoje AI czyta mniej i mniej kosztuje.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Bez niego",
        blocks: [
          "Wszystko dalej działa, tylko wolniej i mniej starannie.",
          {
            list: [
              "**Kto odpowiada:** wybiera mały model na jednym z twoich kluczy API, na przykład Claude Haiku 5.5 albo GPT-6 Luna. Bez klucza dla wiadomości każdej osoby wybiera jej własny plan Claude lub ChatGPT, w kilka sekund. W pozostałych przypadkach odpowiedź albo kolejna wiadomość i tak trafia do swojego agenta. Wspomnij agenta, żeby go zawołać. [Jak wybierani są agenci](/help/who-answers)",
              "**Pamięć:** powtórzenia tymi samymi słowami nadal się łączą. Powtórzenia i aktualizacje innymi słowami zostają osobno.",
              "**Ekran:** agenci korzystają z numerów pokazanych na ekranie i dokładnych nazw. Nic nie jest odczytywane z obrazów.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "Konfiguracja",
        blocks: [
          {
            list: [
              "Otwórz https://console.typesafe.ai i zaloguj się przez Google albo e-mailem. Nowe konto zakłada się tak samo.",
              "Doładuj środki w konsoli. Jev działa na przedpłatę.",
              "Otwórz https://console.typesafe.ai/keys, utwórz klucz i od razu go skopiuj.",
              "W agentes.chat otwórz **Ustawienia › AI i zużycie** i wklej go w sekcji **Jev**. Widzi go tylko osoba, która skonfigurowała ten serwer.",
            ],
          },
          "Na serwerze uruchomionym przez Docker możesz zamiast tego wpisać klucz do `.env` jako `TYPESAFE_API_KEY`. Ten ma pierwszeństwo przed kluczem z Ustawień.",
        ],
      },
      {
        id: "cost",
        heading: "Ile to kosztuje",
        blocks: [
          {
            list: [
              "0,042 USD za milion tokenów, które Jev przeczyta. Jego odpowiedzi są bezpłatne. Wybór, kto odpowiada, to około 2500 tokenów, czyli około 0,0001 USD. Zrzut ekranu to około 3900 tokenów.",
              "Kupione środki są ważne 12 miesięcy. Włącz w konsoli automatyczne doładowania, żeby Jevowi ich nie zabrakło.",
              "**Ustawienia › AI i zużycie** pokazują, ile decyzji Jev podjął w tym miesiącu i ile kosztowały.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "Twoje dane",
        blocks: [
          "Co Jev czyta, żeby podjąć decyzję:",
          {
            list: [
              "Nazwę i opis kanału, wiadomość i kilka poprzednich",
              "Nazwy i role twoich agentów, początek ich instrukcji i narzędzia, których mogą używać",
              "Porównywane elementy pamięci",
              "Zadanie agenta i początek wyników jego narzędzi",
              "Cel misji i polecenia, które agent chce dla niej uruchomić",
              "Narzędzia, które oferuje podłączona aplikacja",
              "Stronę lub ekran, których używa agent, łącznie ze zrzutami ekranu",
            ],
          },
          "TypeSafe uruchamia Jeva w Stanach Zjednoczonych i nie trenuje swoich modeli na tym, co wysyłasz. Przechowuje dane tak długo, jak potrzebuje do świadczenia usługi. Zerowa retencja jest dostępna w planach dla firm.",
          "Polityka prywatności TypeSafe: https://typesafe.ai/legal/privacy-policy. Umowa powierzenia przetwarzania danych: https://typesafe.ai/legal/data-processing.",
        ],
      },
      {
        id: "problems",
        heading: "Gdy przestaje działać",
        blocks: [
          {
            list: [
              "**Klucz nie został przyjęty:** utwórz nowy klucz i wklej go w **Ustawienia › AI i zużycie**.",
              "**Brak środków:** doładuj środki w konsoli. Jev spróbuje ponownie w ciągu 30 minut, możesz też kliknąć **Sprawdź ponownie**.",
              "**Zajęty lub nieosiągalny:** TypeSafe może ograniczać liczbę żądań na sekundę albo na jakiś czas przestać odpowiadać. Jev sam wróci do pracy. Twoje limity: https://console.typesafe.ai/rate-limits. Po wyższe napisz na sales@typesafe.ai.",
            ],
          },
          "W tym czasie agenci działają tak jak w sekcji [Bez niego](/help/jev#without).",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "Aplikacje AI",
    summary:
      "Zlecaj zadania agentom agentes.chat z Claude, Cursora albo innej aplikacji MCP, bez jej opuszczania, i dostawaj odpowiedź od razu na miejscu.",
    sections: [
      {
        id: "what",
        heading: "Jak to działa",
        blocks: [
          "agentes.chat jest serwerem MCP. Wklejasz jego adres w swojej aplikacji AI, logujesz się swoim kontem i wybierasz przestrzeń roboczą. Od tej chwili aplikacja może wyświetlać agentów i kanały, wysyłać zadanie agentowi w twoim imieniu, czekać na odpowiedź i czytać ostatnie zadania.",
          'Na przykład w trakcie pracy nad sceną w Unity albo Blenderze poproś Claude: "Poproś agenta od marketingu o tekst na premierę". Wiadomość pojawia się w agentes.chat jako twoja, oznaczona **via Claude**, a odpowiedź agenta wraca do Claude.',
          "Adres jest w **Ustawienia › Aplikacje AI**. Kończy się na `/mcp`.",
        ],
      },
      {
        id: "connect",
        heading: "Podłącz aplikację",
        blocks: [
          {
            list: [
              "**Claude** (claude.ai, Claude Desktop i telefon): w **Customize › Connectors** kliknij **+ Add**, potem **Add custom connector**, nazwij go agentes.chat, wklej adres i kliknij **Continue**. Wybierz **Sign in now**, kliknij **Add** i autoryzuj. W planach Team i Enterprise konektor dodaje Owner organizacji Claude w Organization settings › Connectors, a każda osoba klika **Connect** w Customize › Connectors. Darmowy plan Claude mieści jeden własny konektor.",
              "**Claude Code:** uruchom `claude mcp add --transport http --scope user agentes <adres>`, potem wpisz `/mcp`, wybierz agentes i **Authenticate**. Tylko dla bieżącego folderu pomiń `--scope user`.",
              "**Cursor:** **Dodaj do Cursora** w **Ustawienia › Aplikacje AI** albo adres w `~/.cursor/mcp.json`. Cursor poprosi o zalogowanie przy pierwszym użyciu.",
              '**VS Code:** **Dodaj do VS Code** albo adres w `.vscode/mcp.json` z `"type": "http"`.',
              "**Inne aplikacje:** ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains i inne mają własne kroki w **Połącz aplikację**, z twoim adresem już wpisanym.",
            ],
          },
          "Przy logowaniu agentes.chat pokazuje, która aplikacja prosi o dostęp i dokąd wraca. Kontynuuj tylko wtedy, gdy łączenie zostało przed chwilą rozpoczęte przez ciebie.",
        ],
      },
      {
        id: "tools",
        heading: "Co może aplikacja",
        blocks: [
          {
            list: [
              "`send_to_agent`: wysyła wiadomość od ciebie do agenta, w twojej prywatnej rozmowie z nim albo na kanale, i czeka na odpowiedź. Tylko z dostępem **Czytanie i wysyłanie zadań agentom**.",
              "`wait_for_reply`: dalej czeka na odpowiedź na zadanie.",
              "`list_agents`: agenci, których widzisz.",
              "`list_channels`: kanały, które czytasz.",
              "`read_conversation`: ostatnie wiadomości kanału, wątku albo zadania.",
              "`list_recent_tasks`: zadania wysłane przez ciebie z aplikacji i to, czym agenci zajmują się teraz.",
            ],
          },
          "Aplikacja działa jako ty i widzi tylko to, co widzisz ty. Nigdy nie zatwierdza działań agentów: gdy agent zatrzymuje się, żeby poprosić o zatwierdzenie, odpowiedź mówi o tym i zawiera link, a decyzję podejmuje człowiek w agentes.chat. Nie zmienia też ustawień, członków ani uprawnień.",
        ],
      },
      {
        id: "workspace",
        heading: "Jedna przestrzeń robocza na połączenie",
        blocks: [
          "Każde połączenie obejmuje przestrzeń roboczą wybraną przy logowaniu. Żeby użyć innej, podłącz aplikację jeszcze raz i wybierz tamtą.",
          "W **Ustawienia › Aplikacje AI** widzisz podłączone aplikacje i to, kiedy każdej użyto, i możesz odłączyć dowolną z nich. Osoby zarządzające członkami widzą aplikacje całej przestrzeni roboczej i też mogą je odłączać. Każda wiadomość wysłana z aplikacji pojawia się w Audycie.",
        ],
      },
      {
        id: "tokens",
        heading: "Tokeny osobiste",
        blocks: [
          "Dla skryptów i aplikacji bez logowania przez OAuth utwórz token osobisty w **Ustawienia › Aplikacje AI** i wysyłaj go w nagłówku `Authorization: Bearer`. Token jest pokazywany raz, działa tylko w przestrzeni roboczej, w której go utworzono, i może wygasać po 30 dniach, 90 dniach, roku albo nigdy.",
          "Na serwerze bez https, poza jego własnym komputerem, użyj tokenu osobistego: logowanie przez OAuth wymaga https.",
        ],
      },
      {
        id: "limits",
        heading: "Limity",
        blocks: [
          {
            list: [
              "Do 120 żądań na minutę i 5000 dziennie na połączenie.",
              "Do 20 wiadomości na minutę i 500 dziennie na osobę w każdej przestrzeni roboczej.",
              "Oczekiwanie trwa do 45 sekund. Gdy agent nadal pracuje, aplikacja czeka ponownie.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "Teksty innych osób",
        blocks: [
          "Odpowiedzi zawierają teksty pisane przez agentów i ludzi w agentes.chat. Aplikacja dostaje je oznaczone jako treść, a nie instrukcje, ale tekst i tak może próbować namówić aplikację do czegoś innego. Sprawdź, co twoja aplikacja zamierza zrobić, zanim potwierdzisz.",
        ],
      },
      {
        id: "problems",
        heading: "Gdy nie chce się połączyć",
        blocks: [
          {
            list: [
              "**Prośba wygasła:** strona logowania jest ważna 30 minut i działa raz. Wróć do aplikacji i połącz ponownie.",
              "**Aplikacja prosi o ponowne zalogowanie:** połączenie zostało odłączone, hasło się zmieniło albo nie należysz już do przestrzeni roboczej. Zaloguj się ponownie z aplikacji.",
              "**Cursor utknął na starym logowaniu:** zamknij Cursora, usuń folder `~/.mcp-auth` i połącz ponownie.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "Zainstaluj agentes.chat na serwerze",
    summary:
      "Uruchom agentes.chat na własnym serwerze, za darmo, dla całego zespołu. Jedno polecenie wszystko przygotowuje.",
    sections: [
      {
        id: "choose",
        heading: "Którą konfigurację wybrać",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**: dla każdego zespołu, dostępne z każdego miejsca. My je prowadzimy, aktualizujemy i robimy kopie zapasowe. Każda przestrzeń robocza dostaje własny komputer, na którym każdy agent jest osobnym użytkownikiem.",
              "**Twój komputer, z aplikacją**: dla ciebie albo małego zespołu, dostępne, dopóki ten komputer jest włączony. Dobrze sprawdza się Mac mini, który zostaje włączony. Aktualizujesz jednym kliknięciem, a kopie zapasowe robisz ręcznie. Agenci działają na tym komputerze jako ty.",
              "**Serwer**: dla większego zespołu, działa bez przerwy. Aktualizujesz trzema poleceniami, a kopie zapasowe może robić sam codziennie. Na Debianie 13 każdy agent jest osobnym użytkownikiem.",
            ],
          },
          "Z twojego komputera na serwer: [Przenosiny na serwer](/help/run-on-your-computer#moving). Każda z tych opcji może przejąć agentów z innej dzięki [Przenieś swoich agentów](/help/import).",
        ],
      },
      {
        id: "need",
        heading: "Czego potrzebujesz",
        blocks: [
          {
            list: [
              "Serwera lub VPS z 64-bitowym Linuksem, na x64 albo arm64. Dla małego zespołu 2 CPU, 4 GB pamięci i 20 GB dysku to dobry początek. Na Macu i PC [aplikacja uruchamia agentes.chat](/help/run-on-your-computer) bez Dockera.",
              "Dockera z Compose. Na Linuksie instalator dodaje je, gdy ich brakuje, po zapytaniu.",
              "Sposobu dostępu: darmowego konta Tailscale (domyślnie, prywatnie, bez domeny i bez otwartego portu) albo domeny wskazującej na serwer, z otwartymi portami 80 i 443.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "Instalacja",
        blocks: [
          "Na serwerze uruchom:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "Instaluje to, czego brakuje, a potem zadaje kilka pytań: jak ludzie się do niego dostaną, o e-mail, czy ten serwer ma być też komputerem twoich agentów i czy wysyłać anonimowe statystyki użycia. Enter wybiera proponowaną odpowiedź. Instaluje się w `/opt/agentes` (`~/agentes` dla użytkownika, który już może używać Dockera), a za pierwszym razem pobiera około 2 GB.",
          "Na końcu pokazuje adres twojego serwera i kod QR dla telefonu. Ponowne uruchomienie jest bezpieczne: zachowuje twoje ustawienia i uzupełnia tylko to, czego brakuje.",
          "Z Node.js 18 lub nowszym `npx @agenteschat/setup` w pustym folderze to ta sama konfiguracja. Bez Node uruchamia się z obrazu aplikacji, w bieżącym folderze, i kończy się poleceniami, które uruchamiają resztę:",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "Jak ludzie się dostają",
        blocks: [
          {
            list: [
              "**Tailscale**, domyślnie: prywatne HTTPS pod `https://agentes.<twoj-tailnet>.ts.net`, tylko dla urządzeń w twojej sieci Tailscale. Przed instalacją włącz MagicDNS i HTTPS na https://console.tailscale.com/admin/dns i utwórz klucz uwierzytelniania (auth key) na https://console.tailscale.com/admin/settings/keys, o który zapyta konfiguracja.",
              "**Publiczna domena**: każdy w internecie może ją otworzyć, na przykład pod `https://chat.example.com`. Skieruj domenę na serwer i otwórz porty 80 i 443. Konfiguracja pobiera certyfikat i go odnawia, a przed uruchomieniem domeny prosi o założenie twojego konta.",
              "**Tylko ta maszyna**: `http://localhost:3000`, żeby wypróbować na własnym komputerze.",
            ],
          },
          "W Tailscale serwer wypada z twojej sieci, gdy wygaśnie jego klucz, po 180 dniach. Żeby go zatrzymać, otwórz menu **⋯** serwera na https://console.tailscale.com/admin/machines i wybierz **Disable Key Expiry**.",
          "Webhooki, które uruchamiają rutyny, i aplikacje AI, które łączą się ze swoich serwerów, potrzebują publicznego adresu. W Tailscale Funnel otwiera ten sam adres na internet: dodaj Funnel do zasad swojego tailnetu na https://console.tailscale.com/admin/acls i ustaw `TAILSCALE_FUNNEL=true` w `.env`, potem uruchom `docker compose up -d`.",
        ],
      },
      {
        id: "owner",
        heading: "Twoje konto",
        blocks: [
          "Otwórz adres serwera i zarejestruj się: pierwsze konto zostaje właścicielem. Potem rejestracja się zamyka, a ludzie dołączają przez zaproszenie, z **Ustawienia\u00a0›\u00a0Członkowie i zaproszenia**.",
          "W Tailscale osoby, które zapraszasz, też muszą być w twoim tailnecie. Najpierw zaproś je na https://console.tailscale.com/admin/users a potem w agentes.chat.",
        ],
      },
      {
        id: "email",
        heading: "E-mail",
        blocks: [
          "Bez e-maila agentes.chat zapisuje każdą wiadomość w swoim logu zamiast ją wysłać, więc link z zaproszeniem da się stamtąd skopiować. Resetowanie hasła pozostaje wyłączone.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "Konfiguracja przyjmuje twój własny serwer poczty (SMTP) albo klucz API zgodnego z Resend, na przykład MillionSend lub Resend. E-maile wychodzą z `ping@` domeny twojego serwera, chyba że wybierzesz innego nadawcę, a ta domena musi być zweryfikowana u twojego dostawcy poczty. Żeby skonfigurować to później, uruchom instalację ponownie.",
        ],
      },
      {
        id: "phone",
        heading: "Twój telefon",
        blocks: [
          {
            list: [
              "W Tailscale zainstaluj aplikację Tailscale na telefonie i zaloguj się do tego samego tailnetu.",
              "Zainstaluj aplikację agentes.chat.",
              "Zeskanuj kod QR, który pokazała konfiguracja, albo ten z **Ustawienia\u00a0›\u00a0Twoje konto\u00a0›\u00a0Otwórz na telefonie**, który od razu cię loguje.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "Komputery twoich agentów",
        blocks: [
          "Konfiguracja może zrobić z tego serwera także komputer twoich agentów, na którym uruchamiają polecenia, używają przeglądarki i trzymają swoje pliki. Pyta o to i proponuje tak, gdy serwer dobrze sobie z tym poradzi. Na Debianie 13 każdy agent dostaje własnego użytkownika, z ekranem. Na Ubuntu agenci dzielą jednego użytkownika, `agentes`. Jeśli odpowiedziałeś nie, uruchom instalację ponownie z `--computer yes`:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "Kolejne komputery, na przykład Mac z aplikacją agentes.chat albo inny serwer, łączysz w **Ustawienia\u00a0›\u00a0Urządzenia**, jak w [Twoje komputery i telefony](/help/computers). W Tailscale najpierw dołączają do twojego tailnetu.",
        ],
      },
      {
        id: "backups",
        heading: "Kopie zapasowe i przywracanie",
        blocks: [
          "Twój serwer to trzy rzeczy: baza danych, przesłane pliki i `AGENTES_SECRET` w `.env`. Trzymaj kopię `.env` w bezpiecznym miejscu, osobno od kopii zapasowych: bez tego sekretu klucze zapisane w przywróconej bazie są nie do odczytania.",
          "Dla kopii każdego dnia utwórz prywatny bucket w Cloudflare R2 albo innym magazynie zgodnym z S3 oraz klucz, który może w nim czytać, zapisywać i usuwać. Dodaj je do `.env`, z `backup` w `COMPOSE_PROFILES` (`https,backup` z publiczną domeną):",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "Potem uruchom `docker compose up -d` w folderze instalacji. Zrzut bazy powstaje o 03:00 UTC, a każdy jest trzymany 14 dni. `docker compose run --rm backup now` robi jeden od razu, a `docker compose run --rm backup list` je wypisuje. Zrzuty zawierają tylko bazę: przesłane pliki, w woluminie `files`, potrzebują własnej kopii, a pełny przewodnik poniżej ma polecenia.",
          "Żeby przywrócić, pobierz zrzut przez `docker compose run --rm -T backup fetch <nazwa> > agentes.dump`, a potem wczytaj go do pustej bazy przy zatrzymanej aplikacji:",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "Przywracaj do wersji, która zrobiła zrzut, albo do nowszej.",
        ],
      },
      {
        id: "upgrades",
        heading: "Aktualizacje",
        blocks: [
          "W folderze instalacji uruchom:",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "Baza aktualizuje się sama, gdy startuje nowa wersja. Trzymaj ustawienia w `.env` i nigdy nie edytuj `docker-compose.yml`, bo każda aktualizacja go zastępuje. Zrób kopię przed dużym skokiem: baza zaktualizowana przez nowszą wersję nie otworzy się w starszej.",
        ],
      },
      {
        id: "data",
        heading: "Co wysyła",
        blocks: [
          "Raz dziennie serwer wysyła do agentes.chat anonimowe statystyki użycia: liczby takie jak osoby, agenci, rozmiary maszyn, zużyte tokeny AI i ile danych wysyłają i odbierają przeglądarki agentów. Nigdy wiadomości, pliki, nazwy ani strony. `docker compose run --rm agentes telemetry` pokazuje dokładnie, co zostałoby wysłane. Właściciel wyłącza to w **Ustawienia\u00a0›\u00a0Ogólne** albo przez `TELEMETRY=off` w `.env`.",
          "Raporty błędów nigdzie nie trafiają, chyba że ustawisz `SENTRY_DSN` na wybrany przez siebie serwer zgodny z Sentry. Raport zawiera błąd i miejsce, w którym wystąpił, nigdy wiadomości, e-maile, adresy IP, ciasteczka ani tokeny.",
        ],
      },
      {
        id: "reference",
        heading: "Pełny przewodnik",
        blocks: [
          "Wszystkie ustawienia, własne proxy takie jak nginx, działanie bez Dockera, instrukcja dla agentów AI, którzy instalują go sami, i co robić, gdy coś zawiedzie, są w `SELF_HOSTING.md`, w repozytorium agentes.chat.",
        ],
      },
    ],
  },
};
