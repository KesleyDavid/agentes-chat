import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

/** The help pages in it: a page not here shows in English. */
export const helpIt: Partial<Record<HelpSlug, HelpDocument>> = {
  "run-on-your-computer": {
    title: "Usa agentes.chat sul tuo computer",
    summary:
      "L’app agentes.chat può anche far girare agentes.chat stesso, su un Mac, un PC o un computer Linux, per te o per un piccolo team.",
    sections: [
      {
        id: "how",
        heading: "Come funziona",
        blocks: [
          "Gira dentro l’app, con un database già incluso, e tiene tutto in una sola cartella di questo computer, `.agentes` nella tua cartella personale. Nient’altro da installare: niente Docker, nessun database da configurare.",
          "Parte con l’app e si ferma quando la chiudi. Prima di chiudere l’app ti chiede conferma, perché nessuno può usare agentes.chat finché non la riapri.",
        ],
      },
      {
        id: "who",
        heading: "Per chi è",
        blocks: [
          "Per te o per un piccolo team. Un Mac mini, un PC in più o un portatile che resta acceso sono una buona casa: preparalo come in [Tienilo acceso](#keep-on). Su un Mac o un PC, l’app è il modo di far girare agentes.chat senza Docker.",
          "Per un team più grande, vedi [Quale configurazione scegliere](/help/install-on-a-server#choose). I tuoi dati potranno spostarsi su un server in seguito.",
        ],
      },
      {
        id: "keep-on",
        heading: "Tienilo acceso",
        blocks: [
          "Su un computer che usano anche altri, preparalo una volta:",
          {
            list: [
              "**Apri all’accesso** si attiva da solo dopo la configurazione.",
              "Su un Mac, attiva **Login automatico** in **Impostazioni di Sistema › Utenti e gruppi**, così l’app si apre dopo un riavvio. FileVault disattiva il login automatico.",
              "Su un Mac, attiva **Avvia automaticamente dopo un’interruzione di corrente** in **Impostazioni di Sistema › Energia**.",
              "Un Mac resta sveglio mentre il server gira e **Raggiungilo dal telefono e dai colleghi** è attivo. Su Windows e Linux, disattiva lo stop nelle impostazioni di alimentazione del sistema.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "Anche i tuoi agenti lavorano qui",
        blocks: [
          "I tuoi agenti lavorano anche su questo computer, in cartelle tutte loro, con un browser, e con Claude Code o Codex se sono installati qui.",
          "Qui gli agenti girano come te. I **Comandi** sono attivi fin dall’inizio, e con loro gli agenti di ogni spazio di lavoro che usa questo computer possono raggiungere tutto ciò che contiene, anche i dati del server. Disattivali in **Preferenze\u00a0›\u00a0Strumenti**. Vedi [Cosa possono raggiungere gli agenti](/help/computers#reach).",
        ],
      },
      {
        id: "another-workspace",
        heading: "Prestalo anche a un altro spazio di lavoro",
        blocks: [
          "Gli spazi di lavoro del server che fai girare qui usano questo computer da soli. Per farlo usare anche a uno spazio di lavoro altrove, come uno su agentes.chat Cloud, apri **Preferenze › Server**, premi **Aggiungi un server…**, accedi a quello spazio di lavoro e premi **Consenti** quando l’app lo chiede.",
          "Ogni spazio di lavoro ha qui i suoi agenti e le sue cartelle. Anche per lui i **Comandi** sono attivi fin dall’inizio. Disattivali nella domanda dell’app prima di premere **Consenti**, o più tardi in **Preferenze\u00a0›\u00a0Strumenti**, dove un solo interruttore vale per tutti gli spazi di lavoro su questo computer.",
        ],
      },
      {
        id: "reach",
        heading: "Dal telefono e dal tuo team",
        blocks: [
          "**Raggiungilo dal telefono e dai colleghi** mette agentes.chat su Tailscale, una rete privata per i tuoi dispositivi: il tuo telefono e le persone che inviti ci entrano, e nessun altro può raggiungere agentes.chat. Tailscale è gratuito: https://tailscale.com/download. Con l’opzione spenta, agentes.chat funziona solo su questo computer.",
          "Se questo computer condivide già qualcos’altro sulla porta 443 di Tailscale, agentes.chat usa la 8443, e il suo indirizzo finisce con `:8443`.",
        ],
      },
      {
        id: "password",
        heading: "Accedere da altri dispositivi",
        blocks: [
          "Il proprietario parte senza password: l’app ti fa accedere su questo computer. Per accedere da un browser su un altro computer, aggiungine una in **Impostazioni › Il tuo account**. L’app per il telefono si collega scansionando il codice QR sotto **Sul telefono**, in **Preferenze › Server**. Serve **Raggiungilo dal telefono e dai colleghi** attivo.",
        ],
      },
      {
        id: "updates",
        heading: "Aggiornamenti",
        blocks: [
          "L’app cerca gli aggiornamenti da sola e ne installa uno quando premi **Aggiorna e riapri** in **Preferenze › Aggiornamenti**. Il server e tutti gli agenti si riavviano con lei. Prima il database viene copiato, e se la nuova versione non risponde entro 3 minuti, l’app torna da sola alla versione precedente e ai suoi dati.",
        ],
      },
      {
        id: "backups",
        heading: "Backup",
        blocks: [
          "Per ora nessun backup parte da solo. **Fai il backup ora**, in **Preferenze › Server**, ferma il server per un momento e salva il database, i file e `.env` in `.agentes/backups`, nella tua cartella personale. Tiene i due più recenti.",
          "Ogni tanto copiali fuori da questo computer, su un disco o in un cloud. Contengono le tue chiavi: tienili privati.",
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code e Codex",
        blocks: [
          "L’app trova Claude Code e Codex tramite il `PATH` della tua shell di login, più le cartelle solite come `~/.local/bin`, `/opt/homebrew/bin` e `/usr/local/bin`. Se **Preferenze › Strumenti** dice **Non trovato**, controlla che `claude` o `codex` funzioni in una nuova finestra di Terminale, poi chiudi e riapri l’app.",
        ],
      },
      {
        id: "moving",
        heading: "Passare a un server",
        blocks: [
          {
            list: ["Chiudi l’app, poi esporta il database con la copia del server che l’app ha con sé. Su un Mac:"],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[Installa agentes.chat su un server](/help/install-on-a-server), ma non avviarlo ancora. Nel suo `.env` metti l’`AGENTES_SECRET` di `~/.agentes/.env`, poi avvia solo il database: `docker compose up -d postgres`.",
              "Carica il dump: `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "Avvialo con `docker compose up -d`, copiaci dentro `~/.agentes/files` come mostra la guida completa, e accedi come prima.",
            ],
          },
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "Il computer dello spazio di lavoro",
    summary: "Ogni spazio di lavoro ha un computer tutto suo, sempre acceso, dove lavorano i suoi agenti.",
    sections: [
      {
        id: "what",
        heading: "Cos’è",
        blocks: [
          "Un computer solo per questo spazio di lavoro, sempre acceso. Ogni agente ha un suo utente, con la sua cartella, il suo schermo, il suo browser e i suoi file. Dalla pagina di un agente puoi guardarlo lavorare, e prendere il controllo quando serve.",
        ],
      },
      {
        id: "own",
        heading: "I tuoi computer e telefoni",
        blocks: [
          "Gli agenti possono lavorare anche su computer e telefoni che porti tu: un Mac o un PC con l’app agentes.chat, un server, un telefono Android o un iPhone. Vedi [I tuoi computer e telefoni](/help/computers).",
        ],
      },
      {
        id: "plans",
        heading: "I tuoi piani IA",
        blocks: [
          "I tuoi agenti possono ragionare con il tuo piano IA, come Claude, ChatGPT, GLM o Kimi, con l’accesso fatto su questo computer: nessuna chiave API necessaria. L’account resta su questo computer, e agentes.chat non vede mai né la password né l’accesso.",
          "I piani AI Pro e Ultra di Google qui non funzionano: i termini di Google non ne permettono l’uso in altri prodotti. Una chiave API di Gemini sì.",
        ],
      },
      {
        id: "size",
        heading: "Le sue dimensioni",
        blocks: ["CPU, memoria e disco sono in **Impostazioni › Dispositivi**."],
      },
      {
        id: "trouble",
        heading: "Se smette di rispondere",
        blocks: ["Di solito torna entro pochi minuti, e ci stiamo già lavorando: tu non devi fare nulla."],
      },
    ],
  },
  computers: {
    title: "I tuoi computer e telefoni",
    summary:
      "Porta un Mac, un PC, un computer Linux, un server o un telefono, e i tuoi agenti ci lavorano. Su agentes.chat Cloud come su un server tutto tuo.",
    sections: [
      {
        id: "app",
        heading: "Dall’app agentes.chat",
        blocks: [
          "Installa l’app sul computer, aprila e accedi al tuo spazio di lavoro. Ti chiede **Lasciare che gli agenti di <workspace> usino questo Mac?** (questo PC su Windows, questo computer su Linux). Scegli chi può usarlo e premi **Consenti**. Tutto qui.",
          "Hai già fatto l’accesso? Attiva lo spazio di lavoro in **Preferenze › Generali**, nella scheda **Agenti**.",
        ],
      },
      {
        id: "web",
        heading: "Dal sito",
        blocks: [
          "In **Impostazioni › Dispositivi**, premi **Collega un dispositivo**:",
          {
            list: [
              "**Questo Mac** o **Questo PC**: apre l’app, che prima ti chiede conferma.",
              "**Un altro computer**: installa l’app lì, accedi con il tuo account e premi **Consenti**. Compare qui da solo.",
              "**Un server o VPS**: esegui una riga nel suo terminale, poi fallo entrare. La riga funziona una volta, per 10 minuti.",
            ],
          },
          "L’app si collega con un clic solo a un indirizzo con https, come uno di Tailscale che finisce con `.ts.net`. Con un semplice indirizzo http, usa la riga per il terminale.",
        ],
      },
      {
        id: "phones",
        heading: "Telefoni",
        blocks: [
          "Un telefono Android si collega tramite qualsiasi computer già collegato: con il cavo, o via Wi-Fi da Android 14 in poi con l’aggiornamento di sicurezza di maggio 2026. Un iPhone si collega tramite un Mac con l’app e Xcode, e al resto pensa l’app. Entrambi partono da **Collega un dispositivo**.",
        ],
      },
      {
        id: "who",
        heading: "Chi può usarlo",
        blocks: [
          "Un nuovo dispositivo è solo per te: **Solo io** vuol dire tu e gli agenti che lavorano per te. Aprilo a tutti nello spazio di lavoro, o ad alcune persone e ruoli, quando lo consenti o più tardi nella sua pagina in **Impostazioni › Dispositivi**.",
        ],
      },
      {
        id: "open",
        heading: "Mentre l’app è aperta",
        blocks: [
          "Gli agenti lavorano su un computer solo mentre l’app gira lì e il computer è sveglio. Quando l’app lo chiede, lascia spuntato **Tienilo pronto: apri agentes.chat all'accesso**. Un computer spento o in stop mostra **Offline**, e gli agenti aspettano che torni.",
        ],
      },
      {
        id: "pausing",
        heading: "Mettere in pausa e scollegare",
        blocks: [
          "Sul computer, l’icona di agentes.chat vicino all’orologio mette in pausa gli agenti di tutti gli spazi di lavoro. In **Preferenze › Generali**, l’interruttore di ogni spazio di lavoro mette in pausa solo quello, e **Esci** lo scollega. In pausa non parte niente di nuovo, e quello che era in corso finisce. Scollegando, le cartelle degli agenti restano sul disco.",
          "Dal sito, **Rimuovi** nella pagina del dispositivo lo scollega.",
        ],
      },
      {
        id: "organizations",
        heading: "Più spazi di lavoro, un solo computer",
        blocks: [
          "Accedi a ogni spazio di lavoro nella stessa app e premi **Consenti** per ognuno. Spazi di lavoro su agentes.chat Cloud e sui tuoi server possono condividere un computer (app 0.6.1 e successive). Ognuno ha lì i suoi agenti e le sue cartelle, e scollegarne uno non tocca gli altri.",
          "Un server che l’app fa girare su questo computer è già collegato e non serve altro. Per prestare quel computer anche a uno spazio di lavoro altrove, vedi [Prestalo anche a un altro spazio di lavoro](/help/run-on-your-computer#another-workspace).",
          "Usi l’app su un portatile solo come finestra sul tuo spazio di lavoro? Quando chiede di lasciare che gli agenti usino il portatile, **Non ora** la lascia una semplice finestra.",
        ],
      },
      {
        id: "folders",
        heading: "Cartelle",
        blocks: [
          "Ogni agente ha sempre una cartella sua, in `~/agentes/<workspace>`. Altre cartelle si autorizzano sul computer stesso, mai dal sito: nell’app, in **Preferenze › Cartelle**, oppure con `agentes-runner folders allow` su un server. Ogni spazio di lavoro autorizza le sue cartelle: quello che autorizzi per uno vale solo per i suoi agenti. Rimuovere una cartella non elimina nulla. Toglie solo l’accesso.",
        ],
      },
      {
        id: "reach",
        heading: "Cosa possono raggiungere gli agenti",
        blocks: [
          "Gli agenti girano come te, l’utente del computer. I loro strumenti per i file restano nelle loro cartelle, ma un comando può leggere tutto quello che puoi leggere tu:",
          {
            list: [
              "i tuoi file e i tuoi accessi",
              "le cartelle degli altri agenti, anche di altri spazi di lavoro, e gli accessi salvati nei loro browser",
              "il token che collega questo computer",
              "su un computer che fa girare anche agentes.chat, il suo database e le sue chiavi in `.agentes`",
            ],
          },
          "agentes.chat rifiuta i comandi che nominano le sue chiavi, i token e gli accessi salvati, ma è una regola, non un muro. I **Comandi** sono attivi fin dall’inizio. Disattivali nella domanda dell’app prima di premere **Consenti**, o più tardi in **Preferenze\u00a0›\u00a0Strumenti**, dove un solo interruttore vale per tutti gli spazi di lavoro sul computer. Claude Code e Codex eseguono i propri comandi nella cartella dell’agente, con le proprie regole.",
          "Per un vero muro, usa un server Linux. Su Debian 13, installato con `--system`, ogni agente è un utente a sé. Su Ubuntu, gli agenti condividono un solo utente, `agentes`: vedono le cartelle degli altri, non le tue né quelle del server. Oppure dai agli agenti un computer tutto loro.",
        ],
      },
    ],
  },
  import: {
    title: "Porta i tuoi agenti",
    summary:
      "Porta qui agenti da un’altra app, o da un altro spazio di lavoro agentes.chat, con istruzioni, skill, routine e memoria.",
    sections: [
      {
        id: "comes",
        heading: "Cosa arriva",
        blocks: [
          {
            list: [
              "Gli agenti, con nome, ruolo, istruzioni e aspetto.",
              "Le skill, attive per gli agenti che le avevano.",
              "I canali pubblici, con i loro agenti.",
              "Le routine, attive e con i loro orari. Se vuoi, mettile in pausa in **Routine**.",
              "La memoria: quello che ricorda ogni agente.",
              "I file di ogni agente (la cartella dei file di OpenBot.run, uno spazio di lavoro OpenClaw), in una cartella con il suo nome nel **Drive**. Chiavi, accessi e file di sistema restano fuori, e niente di quello che c’è già viene sostituito.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "Cosa non arriva mai",
        blocks: [
          "Chiavi, password, accessi e cronologia delle chat non arrivano mai: gli agenti ragionano con l’IA dello spazio di lavoro. Alcune cose qui non hanno ancora un equivalente, o non dovrebbero mai viaggiare in un file. Puoi ricrearle dopo.",
          "File e cartelle vengono letti nel tuo browser. Un link GitHub passa dal server dello spazio di lavoro. I file di chiavi e accessi non vengono mai aperti, e non cambia nulla finché non confermi.",
        ],
      },
      {
        id: "other-apps",
        heading: "Da un’altra app",
        blocks: [
          "Scegli **Grok Bot**, **ChatGPT dots** o **Un’altra app**. Copia la richiesta, incollala in quell’app, poi riporta qui quello che restituisce: trascina il file, o incolla tutta la risposta. Dove la mette ogni app:",
          {
            list: [
              "**Grok Bot**: nella chat con il tuo bot. Risponde con il JSON: copia tutta la risposta.",
              "**ChatGPT dots**: in una nuova chat. Scarica il file che crea.",
              "**Claude**: in una nuova conversazione, o nel progetto dei tuoi agenti. Scarica il file che crea.",
              "**Manus**: in una nuova attività. Il file è nei risultati dell’attività.",
              "**Rakazo**: mandala al tuo agente. Risponde con il JSON: copia tutta la risposta.",
              "**OpenBot**: nessuna richiesta necessaria. Trascina la cartella del tenant (agents.yaml, agents/, model.yaml, skills.yaml) o incolla il suo link GitHub.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "Esporta uno spazio di lavoro",
        blocks: [
          "**Impostazioni › Importa ed esporta › Esporta** scarica un file .json, per portare i tuoi agenti in un altro spazio di lavoro o per tenerne una copia. Nel file:",
          {
            list: [
              "Gli agenti, con istruzioni, modello e aspetto",
              "Le skill, con tutto lo SKILL.md",
              "I canali pubblici, con i loro agenti",
              "Le routine programmate (dall’altra parte arrivano attive)",
              "La memoria che tutti nello spazio di lavoro possono vedere",
            ],
          },
          "Mai nel file:",
          {
            list: [
              "Chiavi API e password",
              "Connettori e accessi",
              "Computer",
              "Conversazioni, messaggi e canali privati",
              "Utilizzo, costi e cronologia delle attività",
            ],
          },
          "Per usare il file, apri **Impostazioni › Importa ed esporta** nell’altro spazio di lavoro e trascina lì il .json.",
        ],
      },
    ],
  },
  wiki: {
    title: "Il wiki",
    summary: "Quello che l’azienda sa, in pagine collegate tra loro.",
    sections: [
      {
        id: "links",
        heading: "Link",
        blocks: [
          "Scrivi [[ per collegare un’altra pagina. I backlink e il grafo mostrano come si collegano le pagine.",
        ],
      },
      {
        id: "agents",
        heading: "Come lo usano gli agenti",
        blocks: ["Gli agenti leggono il wiki quando rispondono. Ci scrivono solo quando qualcuno lo chiede."],
      },
      {
        id: "obsidian",
        heading: "Porta un vault di Obsidian",
        blocks: [
          "Trascina la cartella del vault, o un suo .zip, nel passo Contesto della configurazione o nell’importazione del wiki. [[Link]], [[nota|alias]] e [[nota#sezione]] continuano a funzionare. I tag vengono dal frontmatter e dal testo. Gli allegati vanno nel Drive, e immagini e file incorporati diventano schede nella pagina. I callout restano callout. Le query di Dataview arrivano come testo: chiedi a un agente di costruire la tabella. I canvas e le impostazioni di Obsidian (.obsidian) restano fuori.",
        ],
      },
    ],
  },
  memory: {
    title: "Memoria",
    summary: "Quello che ogni agente impara dalle conversazioni e dalle correzioni del team.",
    sections: [
      {
        id: "learns",
        heading: "Come imparano gli agenti",
        blocks: [
          "Gli agenti imparano dalle conversazioni e dalle correzioni del team. Quello che un agente sa entra nel suo contesto quando serve. Nella sua scheda **Memoria**, modifica, fissa o archivia quello che è sbagliato o superato.",
        ],
      },
      {
        id: "permissions",
        heading: "La memoria non dà permessi",
        blocks: [
          "Niente nella memoria permette a un agente di fare di più. Quello che può fare resta in **Strumenti e accesso**, e le azioni delicate chiedono sempre un’approvazione.",
        ],
      },
      {
        id: "proposals",
        heading: "Modifiche proposte",
        blocks: [
          "Quando una lezione si ripete, l’agente può proporre di cambiare le sue istruzioni o il contesto dello spazio di lavoro. Non cambia nulla finché qualcuno non accetta, e prima si può ritoccare il testo. La versione precedente resta nella cronologia. Una proposta rifiutata resta come lezione, così non viene riproposta.",
        ],
      },
    ],
  },
  approvals: {
    title: "Approvazioni",
    summary: "Le azioni delicate aspettano una persona, una volta o per sempre.",
    sections: [
      {
        id: "what",
        heading: "Cosa chiede prima",
        blocks: [
          "Quando un agente vuole fare un merge, un deploy, un rollback, mandare qualcosa all’esterno o eliminare dati, chiede prima, qualunque accesso abbia. La richiesta compare in **Approvazioni** e nella conversazione, con l’azione esatta e il motivo.",
        ],
      },
      {
        id: "always",
        heading: "Una volta, o sempre",
        blocks: [
          "Approvare copre un’azione esatta, con i suoi valori. Se l’agente cambia qualcosa, chiede di nuovo.",
          "**Approva sempre** lascia che l’agente faccia quel tipo di azione da ora in poi, con qualsiasi valore, senza chiedere. Nella richiesta di una routine, **Sempre in questa routine** fa lo stesso solo per quella routine. Nessuno dei due compare per merge, deploy, rollback e simili. Per annullare, vai in **Strumenti e accesso** nella pagina dell’agente, o nelle impostazioni della routine.",
        ],
      },
      {
        id: "who",
        heading: "Chi approva",
        blocks: [
          {
            list: [
              "Il proprietario dell’agente, per le sue richieste.",
              "Chiunque abbia un ruolo con **Approvare le azioni degli agenti**, per tutti gli agenti.",
              "Le persone che l’agente nomina quando chiede, al posto del proprietario.",
              "Chi copre qualcuno in **Chi approva per me**, per ciò che viene chiesto a quella persona. Merge, deploy e altre azioni a rischio solo quando è attivo.",
            ],
          },
          "Un’azione nella casella di posta di qualcuno aspetta solo quella persona. Un nuovo accesso per un agente aspetta chi gestisce gli agenti.",
          "Lodi, il tuo braccio destro, può anche approvare per te i nuovi agenti proposti da altri agenti e le modifiche a modello, budget e canali di un agente, solo quando l’hai chiesto tu. Chi ti copre e cosa approva Lodi si scelgono in **Impostazioni\u00a0›\u00a0Tu\u00a0›\u00a0Approvazioni**.",
        ],
      },
      {
        id: "refusing",
        heading: "Rifiutare",
        blocks: ["Se vuoi, spiega il motivo: l’agente lo legge, cambia piano e lo tiene come lezione."],
      },
      {
        id: "meetings",
        heading: "Riunioni",
        blocks: [
          "Gli agenti suggeriscono solo gli orari. Gli inviti alle persone passano sempre da chi li ha chiesti.",
        ],
      },
    ],
  },
  "who-answers": {
    title: "Chi risponde a un messaggio",
    summary: "Una menzione sceglie l’agente. Senza menzione, agentes.chat sceglie per te, in questo ordine.",
    sections: [
      {
        id: "order",
        heading: "Come un messaggio trova il suo agente",
        blocks: [
          "Un messaggio che menziona un agente con @ va a quell’agente. Un messaggio che non menziona nessuno viene letto dal primo di questi che lo spazio di lavoro ha:",
          {
            list: [
              "**Jev**, un modello piccolo e veloce fatto per decisioni come questa.",
              "**Un modello piccolo su una delle chiavi API dello spazio di lavoro**, come Claude Haiku 5.5 o GPT-6 Luna.",
              "**Il tuo piano Claude o ChatGPT**, per i messaggi che scrivi tu, su un server che gestisci tu. Li legge sul computer dove hai fatto l’accesso, e ci mette qualche secondo.",
              "**Regole semplici**: una risposta a un agente va a lui, e così un seguito subito dopo che ci hai parlato, o un messaggio in un canale dove sei solo con un agente.",
            ],
          },
          "Quando nessuno di questi va bene, non risponde nessun agente. Menziona un agente per chiamarlo.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "Quando è agentes.chat a ospitare il tuo spazio di lavoro, Jev è incluso. Su un server che gestisci tu, usa la chiave TypeSafe del proprietario, circa 0,0001 US$ a messaggio: [Configura Jev](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "Perché il tuo piano sceglie solo per i tuoi messaggi",
        blocks: [
          "I piani Claude e ChatGPT sono personali, quindi il tuo piano sceglie solo per i messaggi che scrivi tu.",
        ],
      },
      {
        id: "see",
        heading: "Vedere chi ha scelto",
        blocks: ["Apri la spunta sotto un messaggio. L’ultima riga dice chi ha scelto gli agenti."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "Un modello veloce di TypeSafe che prende decisioni rapide per i tuoi agenti. Sul tuo server è facoltativo, con una chiave tua.",
    sections: [
      {
        id: "what",
        heading: "Cosa fa",
        blocks: [
          {
            list: [
              "**Sceglie chi risponde.** Un messaggio senza menzioni arriva all’agente giusto in meno di un secondo, anche quando i tuoi agenti ragionano con un piano e non hai una chiave API.",
              "**Tiene in ordine la memoria.** Riconosce un doppione o un fatto più recente anche se detto con altre parole: il doppione si unisce a quello che l’agente sapeva, e il fatto più recente sostituisce quello vecchio. Una volta al giorno sistema il resto.",
              "**Vede lo schermo.** Nel loro browser e desktop, gli agenti trovano pulsanti e campi da una descrizione, guardano più da vicino quelli piccoli e controllano sull’immagine dello schermo che un passo sia riuscito.",
              "**Legge meno.** Ogni turno carica solo gli strumenti che probabilmente serviranno all’agente, così la tua IA legge meno e costa meno.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Senza Jev",
        blocks: [
          "Tutto continua a funzionare, più lentamente e con meno cura.",
          {
            list: [
              "**Chi risponde:** sceglie un modello piccolo su una delle tue chiavi API, come Claude Haiku 5.5 o GPT-6 Luna. Senza chiave, il piano Claude o ChatGPT di ogni persona sceglie per i messaggi che scrive, in qualche secondo. Altrimenti una risposta o un seguito arriva comunque al suo agente. Menziona un agente per chiamarlo. [Come vengono scelti gli agenti](/help/who-answers)",
              "**Memoria:** i doppioni con le stesse parole si uniscono comunque. Doppioni e aggiornamenti con parole diverse restano separati.",
              "**Schermo:** gli agenti usano i numeri mostrati sullo schermo e i nomi esatti. Dalle immagini non si legge nulla.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "Configuralo",
        blocks: [
          {
            list: [
              "Apri https://console.typesafe.ai e accedi con Google o con la tua email. Un nuovo account si crea allo stesso modo.",
              "Aggiungi credito nella console. Jev è prepagato.",
              "Apri https://console.typesafe.ai/keys, crea una chiave e copiala subito.",
              "In agentes.chat, apri **Impostazioni › IA e consumi** e incollala sotto **Jev**. La vede solo chi ha configurato questo server.",
            ],
          },
          "Su un server che gestisci con Docker, puoi invece mettere la chiave in `.env` come `TYPESAFE_API_KEY`. Questa ha la precedenza su quella in Impostazioni.",
        ],
      },
      {
        id: "cost",
        heading: "Quanto costa",
        blocks: [
          {
            list: [
              "0,042 US$ per milione di token letti da Jev. Le sue risposte sono gratuite. Scegliere chi risponde legge circa 2.500 token, quindi circa 0,0001 US$. Uno screenshot è circa 3.900 token.",
              "Il credito che acquisti dura 12 mesi. Attiva le ricariche automatiche nella console così Jev non resta a secco.",
              "**Impostazioni › IA e consumi** mostra quante decisioni ha preso Jev questo mese, e quanto sono costate.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "I tuoi dati",
        blocks: [
          "Cosa legge Jev per decidere:",
          {
            list: [
              "Il nome e la descrizione del canale, il messaggio e i pochi precedenti",
              "I nomi e i ruoli dei tuoi agenti, l’inizio delle loro istruzioni e gli strumenti che possono usare",
              "Gli elementi di memoria che confronta",
              "L’attività di un agente e l’inizio dei risultati dei suoi strumenti",
              "L’obiettivo di una missione e i comandi che un agente vuole eseguire per portarla avanti",
              "Gli strumenti offerti da un’app collegata",
              "La pagina o lo schermo che un agente sta usando, screenshot inclusi",
            ],
          },
          "TypeSafe fa girare Jev negli Stati Uniti e non addestra i suoi modelli su quello che invii. Conserva i dati per il tempo necessario a far funzionare il servizio. La conservazione zero è disponibile nei suoi piani enterprise.",
          "Informativa sulla privacy di TypeSafe: https://typesafe.ai/legal/privacy-policy. Il suo accordo sul trattamento dei dati: https://typesafe.ai/legal/data-processing.",
        ],
      },
      {
        id: "problems",
        heading: "Quando si ferma",
        blocks: [
          {
            list: [
              "**Chiave non accettata:** crea una nuova chiave e incollala in **Impostazioni › IA e consumi**.",
              "**Credito esaurito:** aggiungi credito nella console. Jev riprova entro 30 minuti, oppure fai clic su **Controlla di nuovo**.",
              "**Occupato o irraggiungibile:** TypeSafe può limitare le richieste al secondo, o smettere di rispondere per un po’. Jev riparte da solo. I tuoi limiti: https://console.typesafe.ai/rate-limits. Per limiti più alti, scrivi a sales@typesafe.ai.",
            ],
          },
          "Nel frattempo, gli agenti lavorano come in [Senza Jev](/help/jev#without).",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "App IA",
    summary:
      "Chiedi attività agli agenti di agentes.chat da Claude, Cursor o un’altra app MCP, senza uscirne, e ricevi la risposta lì.",
    sections: [
      {
        id: "what",
        heading: "Come funziona",
        blocks: [
          "agentes.chat è un server MCP. Incolli il suo indirizzo nella tua app IA, accedi con il tuo account e scegli uno spazio di lavoro. Da lì in poi, l’app può elencare agenti e canali, mandare un’attività a un agente a nome tuo, aspettare la risposta e leggere le attività recenti.",
          "Per esempio, nel mezzo di una scena in Unity o Blender, chiedi a Claude: “Chiedi all’agente marketing un testo per il lancio”. Il messaggio compare in agentes.chat come tuo, con l’etichetta **via Claude**, e la risposta dell’agente torna a Claude.",
          "L’indirizzo è in **Impostazioni › App IA**. Finisce con `/mcp`.",
        ],
      },
      {
        id: "connect",
        heading: "Collega un’app",
        blocks: [
          {
            list: [
              "**Claude** (claude.ai, Claude Desktop e telefono): in **Personalizza › Connettori** (Customize › Connectors), fai clic su **+ Aggiungi**, poi su **Aggiungi connettore personalizzato** (Add custom connector), chiamalo agentes.chat, incolla l’indirizzo e fai clic su **Continua**. Scegli **Accedi ora** (Sign in now), fai clic su **Aggiungi** e autorizza. Nei piani Team ed Enterprise, il Proprietario dell’organizzazione Claude aggiunge il connettore in Impostazioni dell’organizzazione › Connettori, e ogni persona fa clic su **Connetti** in Personalizza › Connettori. Il piano gratuito di Claude ha posto per un connettore personalizzato.",
              "**Claude Code:** esegui `claude mcp add --transport http --scope user agentes <indirizzo>`, poi scrivi `/mcp`, scegli agentes e **Authenticate**. Solo per la cartella attuale, togli `--scope user`.",
              "**Cursor:** **Aggiungi a Cursor** in **Impostazioni › App IA**, oppure l’indirizzo in `~/.cursor/mcp.json`. Cursor ti chiede di accedere la prima volta che lo usi.",
              '**VS Code:** **Aggiungi a VS Code**, oppure l’indirizzo in `.vscode/mcp.json` con `"type": "http"`.',
              "**Altre app:** ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains e altre hanno ciascuna i propri passaggi in **Collega un'app**, con il tuo indirizzo già inserito.",
            ],
          },
          "Quando accedi, agentes.chat mostra quale app ha chiesto l’accesso e dove torna. Continua solo se hai appena avviato tu il collegamento.",
        ],
      },
      {
        id: "tools",
        heading: "Cosa può fare l’app",
        blocks: [
          {
            list: [
              "`send_to_agent`: manda un tuo messaggio a un agente, nella tua conversazione privata con lui o in un canale, e aspetta la risposta. Solo con l’accesso **Leggere e mandare attività agli agenti**.",
              "`wait_for_reply`: continua ad aspettare la risposta a un’attività.",
              "`list_agents`: gli agenti che vedi.",
              "`list_channels`: i canali che leggi.",
              "`read_conversation`: i messaggi recenti di un canale, di un thread o di un’attività.",
              "`list_recent_tasks`: le attività che hai mandato dalle app e quello che gli agenti stanno facendo ora.",
            ],
          },
          "L’app agisce a nome tuo e vede solo quello che vedi tu. Non approva mai le azioni degli agenti: quando un agente si ferma per chiedere un’approvazione, la risposta lo dice con un link, e una persona decide in agentes.chat. Non cambia nemmeno impostazioni, membri o permessi.",
        ],
      },
      {
        id: "workspace",
        heading: "Uno spazio di lavoro per collegamento",
        blocks: [
          "Ogni collegamento copre lo spazio di lavoro scelto al momento dell’accesso. Per usare un altro spazio di lavoro, collega di nuovo l’app e scegli l’altro.",
          "In **Impostazioni › App IA** vedi le app collegate, quando è stata usata ognuna, e puoi scollegarne qualsiasi. Chi gestisce i membri vede le app di tutto lo spazio di lavoro e può scollegarle anche lui. Ogni messaggio mandato da un’app compare nell’Audit.",
        ],
      },
      {
        id: "tokens",
        heading: "Token personali",
        blocks: [
          "Per script e app senza accesso OAuth, crea un token personale in **Impostazioni › App IA** e mandalo nell’intestazione `Authorization: Bearer`. Il token si vede una volta sola, funziona solo nello spazio di lavoro in cui è stato creato e può scadere dopo 30 giorni, 90 giorni, 1 anno o mai.",
          "Su un server senza https, lontano dal suo computer, usa un token personale: l’accesso OAuth ha bisogno di https.",
        ],
      },
      {
        id: "limits",
        heading: "Limiti",
        blocks: [
          {
            list: [
              "Fino a 120 richieste al minuto e 5.000 al giorno per collegamento.",
              "Fino a 20 messaggi al minuto e 500 al giorno per persona in ogni spazio di lavoro.",
              "Un’attesa dura fino a 45 secondi. Se l’agente sta ancora lavorando, l’app aspetta di nuovo.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "Testo scritto da altri",
        blocks: [
          "Le risposte contengono testo scritto da agenti e persone in agentes.chat. L’app riceve quel testo segnato come contenuto, non come istruzioni, ma un testo può comunque provare a convincere l’app a fare altro. Controlla cosa sta per fare la tua app prima di confermare.",
        ],
      },
      {
        id: "problems",
        heading: "Quando non si collega",
        blocks: [
          {
            list: [
              "**Richiesta scaduta:** la pagina di accesso dura 30 minuti e funziona una volta sola. Torna all’app e collegati di nuovo.",
              "**L’app chiede di accedere di nuovo:** il collegamento è stato rimosso, la password è cambiata o sei uscito dallo spazio di lavoro. Accedi di nuovo dall’app.",
              "**Cursor bloccato su un vecchio accesso:** chiudi Cursor, elimina la cartella `~/.mcp-auth` e collegati di nuovo.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "Installa agentes.chat su un server",
    summary: "Usa agentes.chat su un server tuo, gratis, per tutto il team. Un comando prepara tutto.",
    sections: [
      {
        id: "choose",
        heading: "Quale configurazione scegliere",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**: per qualsiasi team, raggiungibile da ovunque. Lo gestiamo, aggiorniamo e salviamo noi. Ogni spazio di lavoro ha un computer tutto suo, dove ogni agente è un utente a sé.",
              "**Il tuo computer, con l’app**: per te o per un piccolo team, raggiungibile finché quel computer è acceso. Un Mac mini sempre acceso va benissimo. Lo aggiorni con un clic e ne fai il backup a mano. Gli agenti girano come te su quel computer.",
              "**Un server**: per un team più grande, attivo sempre. Lo aggiorni con tre comandi, e può fare il backup da solo ogni giorno. Su Debian 13, ogni agente è un utente a sé.",
            ],
          },
          "Dal tuo computer a un server: [Passare a un server](/help/run-on-your-computer#moving). Ognuno può portare agenti da un altro con [Porta i tuoi agenti](/help/import).",
        ],
      },
      {
        id: "need",
        heading: "Cosa ti serve",
        blocks: [
          {
            list: [
              "Un server o una VPS con Linux a 64 bit, su x64 o arm64. Per un team piccolo, 2 CPU, 4 GB di memoria e 20 GB di disco sono un buon inizio. Su un Mac o un PC, [l’app fa girare agentes.chat](/help/run-on-your-computer) senza Docker.",
              "Docker con Compose. Su Linux l'installer li aggiunge quando mancano, dopo averti chiesto.",
              "Un modo per arrivarci: un account Tailscale gratuito (la scelta predefinita, privata, senza dominio e senza porte aperte) oppure un dominio che punta al server, con le porte 80 e 443 aperte.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "Installalo",
        blocks: [
          "Sul server, esegui:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "Installa ciò che manca e poi fa qualche domanda: come ci arrivano le persone, l'email, se questo server è anche il computer dei tuoi agenti e se inviare statistiche d'uso anonime. Invio accetta la risposta suggerita. Si installa in `/opt/agentes` (`~/agentes` per un utente che può già usare Docker) e la prima volta scarica circa 2 GB.",
          "Alla fine mostra l'indirizzo del tuo server e un codice QR per il telefono. Eseguirlo di nuovo non rompe niente: tiene le tue impostazioni e completa solo ciò che manca.",
          "Con Node.js 18 o più recente, `npx @agenteschat/setup` in una cartella vuota è la stessa configurazione. Senza Node, gira dall'immagine dell'app, nella cartella corrente, e finisce con i comandi che avviano il resto:",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "Come ci arrivano le persone",
        blocks: [
          {
            list: [
              "**Tailscale**, la scelta predefinita: HTTPS privato su `https://agentes.<la-tua-tailnet>.ts.net`, solo per i dispositivi della tua rete Tailscale. Prima di installare, attiva MagicDNS e HTTPS su https://console.tailscale.com/admin/dns e crea una chiave di accesso (auth key) su https://console.tailscale.com/admin/settings/keys da dare alla configurazione quando la chiede.",
              "**Un dominio pubblico**: chiunque su internet può aprirlo, per esempio su `https://chat.example.com`. Punta il dominio al server e apri le porte 80 e 443. La configurazione ottiene il certificato e lo rinnova, e ti fa creare il tuo account prima che il dominio vada online.",
              "**Solo questa macchina**: `http://localhost:3000`, per provarlo sul tuo computer.",
            ],
          },
          "Su Tailscale, il server esce dalla tua rete quando la sua chiave scade, dopo 180 giorni. Per tenerlo, apri il menu **⋯** del server su https://console.tailscale.com/admin/machines e scegli **Disable Key Expiry**.",
          "I webhook che avviano routine e le app di IA che chiamano dai propri server hanno bisogno di un indirizzo pubblico. Su Tailscale, Funnel apre lo stesso indirizzo a internet: aggiungi Funnel alla policy della tua tailnet su https://console.tailscale.com/admin/acls e imposta `TAILSCALE_FUNNEL=true` in `.env`, poi esegui `docker compose up -d`.",
        ],
      },
      {
        id: "owner",
        heading: "Il tuo account",
        blocks: [
          "Apri l'indirizzo del tuo server e registrati: il primo account diventa il proprietario. Poi le registrazioni si chiudono e le persone entrano su invito, da **Impostazioni\u00a0›\u00a0Membri e inviti**.",
          "Su Tailscale, anche le persone che inviti devono essere nella tua tailnet. Invitale prima su https://console.tailscale.com/admin/users e poi in agentes.chat.",
        ],
      },
      {
        id: "email",
        heading: "Email",
        blocks: [
          "Senza email, agentes.chat scrive ogni email nel suo log invece di inviarla, così puoi copiare da lì un link di invito. Il ripristino della password resta spento.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "La configurazione accetta il tuo server di posta (SMTP) o la chiave di un'API compatibile con Resend, come MillionSend o Resend. Le email partono da `ping@<dominio del tuo server>`, a meno che tu non scelga un altro mittente, e quel dominio deve essere verificato presso il tuo provider di email. Per configurarla più tardi, esegui di nuovo l'installazione.",
        ],
      },
      {
        id: "phone",
        heading: "Il tuo telefono",
        blocks: [
          {
            list: [
              "Su Tailscale, installa l'app Tailscale sul telefono e accedi alla stessa tailnet.",
              "Installa l'app agentes.chat.",
              "Scansiona il codice QR mostrato dalla configurazione, oppure quello in **Impostazioni\u00a0›\u00a0Il tuo account\u00a0›\u00a0Apri sul telefono**, che ti fa anche accedere.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "I computer dei tuoi agenti",
        blocks: [
          "La configurazione può rendere questo server anche il computer dei tuoi agenti, dove eseguono comandi, usano un browser e tengono i loro file. Te lo chiede, e suggerisce sì dove il server può farlo bene. Su Debian 13 ogni agente ha un utente tutto suo, con uno schermo. Su Ubuntu, gli agenti condividono un solo utente, `agentes`. Se hai detto no, esegui di nuovo l'installazione con `--computer yes`:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "Altri computer, come un Mac con l'app agentes.chat o un altro server, si collegano da **Impostazioni\u00a0›\u00a0Dispositivi**, come in [I tuoi computer e telefoni](/help/computers). Su Tailscale, prima entrano nella tua tailnet.",
        ],
      },
      {
        id: "backups",
        heading: "Backup e ripristino",
        blocks: [
          "Il tuo server è fatto di tre cose: il database, i file caricati e `AGENTES_SECRET` in `.env`. Tieni una copia di `.env` in un posto sicuro, separata dai backup: senza il segreto, le chiavi salvate in un database ripristinato non si possono leggere.",
          "Per un backup ogni giorno, crea un bucket privato su Cloudflare R2 o un altro servizio compatibile con S3, e una chiave che possa leggere, scrivere e cancellare lì. Aggiungili a `.env`, con `backup` in `COMPOSE_PROFILES` (`https,backup` con un dominio pubblico):",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "Poi esegui `docker compose up -d` nella cartella dell'installazione. Il database viene salvato alle 03:00 UTC e ogni backup resta 14 giorni. `docker compose run --rm backup now` ne fa uno subito, e `docker compose run --rm backup list` li elenca. I backup contengono solo il database: i file caricati, nel volume `files`, hanno bisogno di una copia a parte, e la guida completa, più sotto, ha i comandi.",
          "Per ripristinare, scarica un backup con `docker compose run --rm -T backup fetch <nome> > agentes.dump` e caricalo in un database vuoto, con l'app ferma:",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "Ripristina nella versione che ha fatto il backup o in una più recente.",
        ],
      },
      {
        id: "upgrades",
        heading: "Aggiornamenti",
        blocks: [
          "Nella cartella dell'installazione, esegui:",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "Il database si aggiorna da solo quando parte la nuova versione. Tieni le tue impostazioni in `.env` e non modificare mai `docker-compose.yml`, che ogni aggiornamento sostituisce. Fai un backup prima di un grande salto: un database aggiornato da una versione più recente non si apre in una più vecchia.",
        ],
      },
      {
        id: "data",
        heading: "Cosa invia",
        blocks: [
          "Una volta al giorno il server invia ad agentes.chat statistiche d'uso anonime: conteggi come persone, agenti, dimensioni delle macchine, token di IA usati e quanti dati inviano e ricevono i browser degli agenti. Mai messaggi, file, nomi o siti. `docker compose run --rm agentes telemetry` mostra esattamente cosa invierebbe. Il proprietario le spegne in **Impostazioni\u00a0›\u00a0Generali**, oppure con `TELEMETRY=off` in `.env`.",
          "I report degli errori non vanno da nessuna parte, a meno che tu non imposti `SENTRY_DSN` su un server compatibile con Sentry scelto da te. Un report contiene l'errore e dove è successo, mai messaggi, email, indirizzi IP, cookie o token.",
        ],
      },
      {
        id: "reference",
        heading: "La guida completa",
        blocks: [
          "Tutte le impostazioni, un proxy tuo come nginx, l'uso senza Docker, una guida per gli agenti di IA che lo installano da soli e cosa fare quando qualcosa non va sono in `SELF_HOSTING.md`, nel repository di agentes.chat.",
        ],
      },
    ],
  },
};
