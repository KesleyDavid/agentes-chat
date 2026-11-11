import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

/** The help pages in fr: a page not here shows in English. */
export const helpFr: Partial<Record<HelpSlug, HelpDocument>> = {
  "run-on-your-computer": {
    title: "Faire tourner agentes.chat sur votre ordinateur",
    summary:
      "L’app agentes.chat peut aussi faire tourner agentes.chat lui-même, sur un Mac, un PC ou un ordinateur sous Linux, pour vous ou une petite équipe.",
    sections: [
      {
        id: "how",
        heading: "Comment ça fonctionne",
        blocks: [
          "Il tourne dans l’app, avec sa propre base de données intégrée, et garde tout dans un seul dossier de cet ordinateur, `.agentes` dans votre dossier personnel. Rien d’autre à installer : ni Docker, ni base de données à configurer.",
          "Il démarre avec l’app et s’arrête quand vous la quittez. L’app vous demande confirmation avant de quitter, car personne ne peut utiliser agentes.chat tant qu’elle n’est pas rouverte.",
        ],
      },
      {
        id: "who",
        heading: "Pour qui",
        blocks: [
          "Vous ou une petite équipe. Un Mac mini, un PC inutilisé ou un portable qui reste allumé fait très bien l’affaire\u00a0: préparez-le comme dans [Le garder allumé](#keep-on). Sur un Mac ou un PC, l’app permet de faire tourner agentes.chat sans Docker.",
          "Pour une équipe plus grande, voir [Quelle installation choisir](/help/install-on-a-server#choose). Vos données pourront passer sur un serveur plus tard.",
        ],
      },
      {
        id: "keep-on",
        heading: "Le garder allumé",
        blocks: [
          "Sur un ordinateur que d’autres utilisent, préparez-le une fois\u00a0:",
          {
            list: [
              "**Ouvrir à la connexion** s’active tout seul après la configuration.",
              "Sur un Mac, choisissez votre compte dans **Connexion automatique en tant que**, dans **Réglages Système\u00a0›\u00a0Utilisateurs et groupes**, pour que l’app s’ouvre après un redémarrage. FileVault désactive la connexion automatique.",
              "Sur un Mac, activez **Démarrer automatiquement après une panne de courant** dans **Réglages Système\u00a0›\u00a0Énergie**.",
              "Un Mac reste éveillé tant que le serveur tourne et que **Y accéder depuis votre téléphone et vos collègues** est activé. Sous Windows et Linux, désactivez la veille dans les réglages d’alimentation du système.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "Vos agents travaillent ici aussi",
        blocks: [
          "Vos agents travaillent aussi sur cet ordinateur, dans des dossiers rien qu’à eux, avec un navigateur, et avec Claude Code ou Codex s’ils sont installés ici.",
          "Ici, les agents tournent sous votre compte. Les **Commandes** sont activées par défaut, et avec elles les agents de chaque espace de travail qui utilise cet ordinateur peuvent atteindre tout ce qu’il contient, y compris les données du serveur. Désactivez-les dans **Préférences\u00a0›\u00a0Outils**. Voir [Ce que les agents peuvent atteindre](/help/computers#reach).",
        ],
      },
      {
        id: "another-workspace",
        heading: "Le prêter aussi à un autre espace de travail",
        blocks: [
          "Les espaces de travail du serveur que vous faites tourner ici utilisent déjà cet ordinateur, sans rien à faire. Pour qu’un espace de travail d’ailleurs l’utilise aussi, par exemple sur agentes.chat Cloud, ouvrez **Préférences\u00a0›\u00a0Serveurs**, cliquez sur **Ajouter un serveur…**, connectez-vous à cet espace de travail et cliquez sur **Autoriser** quand l’app le demande.",
          "Chaque espace de travail a ici ses propres agents et dossiers. Les **Commandes** y sont aussi activées par défaut. Désactivez-les dans la question de l’app avant d’appuyer sur **Autoriser**, ou plus tard dans **Préférences\u00a0›\u00a0Outils**, où un seul interrupteur vaut pour tous les espaces de travail de cet ordinateur.",
        ],
      },
      {
        id: "reach",
        heading: "Depuis votre téléphone et votre équipe",
        blocks: [
          "**Y accéder depuis votre téléphone et vos collègues** place agentes.chat sur Tailscale, un réseau privé pour vos appareils : votre téléphone et les personnes que vous invitez le rejoignent, et personne d’autre ne peut atteindre agentes.chat. Tailscale est gratuit : https://tailscale.com/download. Quand cette option est désactivée, agentes.chat ne fonctionne que sur cet ordinateur.",
          "Si cet ordinateur partage déjà autre chose sur le port 443 de Tailscale, agentes.chat prend le 8443, et son adresse se termine par `:8443`.",
        ],
      },
      {
        id: "password",
        heading: "Se connecter depuis d’autres appareils",
        blocks: [
          "Le propriétaire commence sans mot de passe\u00a0: l’app vous connecte sur cet ordinateur. Pour vous connecter depuis un navigateur sur un autre ordinateur, ajoutez-en un dans **Paramètres\u00a0›\u00a0Votre compte**. L’app mobile se connecte en scannant le QR code sous **Sur votre téléphone**, dans **Préférences\u00a0›\u00a0Serveurs**. Il faut pour cela que **Y accéder depuis votre téléphone et vos collègues** soit activé.",
        ],
      },
      {
        id: "updates",
        heading: "Mises à jour",
        blocks: [
          "L’app cherche les mises à jour toute seule, et en installe une quand vous cliquez sur **Mettre à jour et rouvrir** dans **Préférences\u00a0›\u00a0Mises à jour**. Le serveur et tous les agents redémarrent avec elle. La base de données est d’abord copiée, et si la nouvelle version ne répond pas dans les 3 minutes, l’app revient toute seule à la version précédente et à ses données.",
        ],
      },
      {
        id: "backups",
        heading: "Sauvegardes",
        blocks: [
          "Rien ne se sauvegarde encore tout seul. **Sauvegarder maintenant**, dans **Préférences\u00a0›\u00a0Serveurs**, arrête le serveur un instant et enregistre la base de données, les fichiers et le `.env` dans `.agentes/backups`, dans votre dossier personnel. Les deux plus récentes sont gardées.",
          "De temps en temps, copiez-les hors de cet ordinateur, sur un disque ou un stockage en ligne. Elles contiennent vos clés\u00a0: gardez-les privées.",
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code et Codex",
        blocks: [
          "L’app trouve Claude Code et Codex grâce au `PATH` de votre shell de connexion, plus les dossiers habituels comme `~/.local/bin`, `/opt/homebrew/bin` et `/usr/local/bin`. Si **Préférences\u00a0›\u00a0Outils** indique **Introuvable**, vérifiez que `claude` ou `codex` se lance dans une nouvelle fenêtre du Terminal, puis quittez et rouvrez l’app.",
        ],
      },
      {
        id: "moving",
        heading: "Passer sur un serveur",
        blocks: [
          {
            list: [
              "Quittez l’app, puis exportez la base de données avec la copie du serveur fournie dans l’app. Sur un Mac\u00a0:",
            ],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[Installez agentes.chat sur un serveur](/help/install-on-a-server), mais ne le démarrez pas encore. Dans son `.env`, mettez le `AGENTES_SECRET` de `~/.agentes/.env`, puis démarrez seulement la base de données\u00a0: `docker compose up -d postgres`.",
              "Chargez l’export\u00a0: `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "Démarrez-le avec `docker compose up -d`, copiez `~/.agentes/files` dedans comme le montre le guide complet, et connectez-vous comme avant.",
            ],
          },
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "L’ordinateur de l’espace de travail",
    summary: "Chaque espace de travail a son propre ordinateur, toujours allumé, où ses agents travaillent.",
    sections: [
      {
        id: "what",
        heading: "Ce que c’est",
        blocks: [
          "Un ordinateur rien que pour cet espace de travail, toujours allumé. Chaque agent y a son propre utilisateur, avec son dossier, son écran, son navigateur et ses fichiers. Depuis la page d’un agent, vous pouvez le regarder travailler, et prendre la main quand vous en avez besoin.",
        ],
      },
      {
        id: "own",
        heading: "Vos propres ordinateurs et téléphones",
        blocks: [
          "Les agents peuvent aussi travailler sur les ordinateurs et téléphones que vous connectez\u00a0: un Mac ou un PC avec l’app agentes.chat, un serveur, un téléphone Android ou un iPhone. Voir [Les ordinateurs et téléphones que vous connectez](/help/computers).",
        ],
      },
      {
        id: "plans",
        heading: "Vos abonnements IA",
        blocks: [
          "Vos agents peuvent réfléchir avec votre propre abonnement IA, comme Claude, ChatGPT, GLM ou Kimi, connecté sur cet ordinateur : pas besoin de clé API. Le compte reste sur cet ordinateur, et agentes.chat ne voit jamais le mot de passe ni l’accès.",
          "Les abonnements AI Pro et Ultra de Google ne fonctionnent pas ici : les conditions de Google ne les autorisent pas dans d’autres produits. Une clé API Gemini, si.",
        ],
      },
      {
        id: "size",
        heading: "Sa taille",
        blocks: ["Ses processeurs, sa mémoire et son disque sont indiqués dans **Paramètres\u00a0›\u00a0Appareils**."],
      },
      {
        id: "trouble",
        heading: "S’il ne répond plus",
        blocks: ["Il revient en général en quelques minutes, et nous nous en occupons : vous n’avez rien à faire."],
      },
    ],
  },
  computers: {
    title: "Vos ordinateurs et téléphones",
    summary:
      "Apportez un Mac, un PC, un ordinateur sous Linux, un serveur ou un téléphone, et vos agents travaillent dessus. Sur agentes.chat Cloud comme sur votre propre serveur.",
    sections: [
      {
        id: "app",
        heading: "Depuis l’app agentes.chat",
        blocks: [
          "Installez l’app sur l’ordinateur, ouvrez-la et connectez-vous à votre espace de travail. Elle demande **Laisser les agents de <workspace> utiliser ce Mac\u00a0?** (ce PC sous Windows, cet ordinateur sous Linux). Choisissez qui peut l’utiliser et cliquez sur **Autoriser**. C’est tout.",
          "Déjà connecté\u00a0? Activez l’espace de travail dans **Préférences\u00a0›\u00a0Général**, dans la carte **Agents**.",
        ],
      },
      {
        id: "web",
        heading: "Depuis le site",
        blocks: [
          "Dans **Paramètres\u00a0›\u00a0Appareils**, cliquez sur **Connecter un appareil**\u00a0:",
          {
            list: [
              "**Ce Mac** ou **Ce PC**\u00a0: ouvre l’app, qui vous demande d’abord.",
              "**Un autre ordinateur**\u00a0: installez-y l’app, connectez-vous avec votre compte et cliquez sur **Autoriser**. Il apparaît ici tout seul.",
              "**Un serveur ou un VPS**\u00a0: lancez une ligne dans son terminal, puis laissez-le rejoindre. La ligne marche une fois, pendant 10 minutes.",
            ],
          },
          "L’app ne se connecte en un clic qu’à une adresse en https, comme une adresse Tailscale qui se termine par `.ts.net`. Sur une simple adresse http, utilisez la ligne de terminal.",
        ],
      },
      {
        id: "phones",
        heading: "Téléphones",
        blocks: [
          "Un téléphone Android se connecte via n’importe quel ordinateur déjà connecté\u00a0: par câble, ou en Wi-Fi à partir d’Android 14 avec la mise à jour de sécurité de mai 2026. Un iPhone se connecte via un Mac qui a l’app et Xcode, et l’app prépare le reste. Les deux commencent par **Connecter un appareil**.",
        ],
      },
      {
        id: "who",
        heading: "Qui peut l’utiliser",
        blocks: [
          "Un nouvel appareil est pour vous seul\u00a0: **Moi seulement** veut dire vous et les agents qui travaillent pour vous. Ouvrez-le à tout l’espace de travail, ou à certaines personnes et certains rôles, au moment de l’autoriser ou plus tard sur sa page dans **Paramètres\u00a0›\u00a0Appareils**.",
        ],
      },
      {
        id: "open",
        heading: "Tant que l’app est ouverte",
        blocks: [
          "Les agents travaillent sur un ordinateur seulement tant que l’app y tourne et que l’ordinateur est éveillé. Quand l’app le demande, laissez coché **Le garder prêt\u00a0: ouvrir agentes.chat à la connexion**. Un ordinateur éteint ou en veille apparaît **Hors ligne**, et les agents attendent son retour.",
        ],
      },
      {
        id: "pausing",
        heading: "Mettre en pause et déconnecter",
        blocks: [
          "Sur l’ordinateur, l’icône agentes.chat près de l’horloge met en pause les agents de tous les espaces de travail. Dans **Préférences\u00a0›\u00a0Général**, l’interrupteur de chaque espace de travail ne met en pause que celui-ci, et **Quitter** le déconnecte. Rien de nouveau ne démarre pendant la pause, et ce qui était en cours se termine. Déconnecter garde les dossiers des agents sur le disque.",
          "Depuis le site, **Retirer** sur la page de l’appareil le déconnecte.",
        ],
      },
      {
        id: "organizations",
        heading: "Plusieurs espaces de travail, un seul ordinateur",
        blocks: [
          "Connectez-vous à chaque espace de travail dans la même app et cliquez sur **Autoriser** pour chacun. Des espaces de travail sur agentes.chat Cloud et sur vos propres serveurs peuvent partager un ordinateur (app 0.6.1 et plus récente). Chacun y a ses propres agents et dossiers, et en déconnecter un ne touche pas aux autres.",
          "Un serveur que l’app fait tourner sur cet ordinateur est déjà connecté et n’a besoin de rien. Pour prêter aussi cet ordinateur à un espace de travail d’ailleurs, voir [Le prêter aussi à un autre espace de travail](/help/run-on-your-computer#another-workspace).",
          "Vous utilisez l’app sur un portable seulement comme fenêtre sur votre espace de travail\u00a0? Quand elle propose de laisser les agents utiliser le portable, **Plus tard** le garde comme simple fenêtre.",
        ],
      },
      {
        id: "folders",
        heading: "Dossiers",
        blocks: [
          "Chaque agent a toujours son propre dossier, dans `~/agentes/<workspace>`. D’autres dossiers peuvent être autorisés sur l’ordinateur lui-même, jamais depuis le site : dans l’app, via **Préférences › Dossiers**, ou avec `agentes-runner folders allow` sur un serveur. Chaque espace de travail autorise ses propres dossiers : ce que vous autorisez pour l’un ne vaut que pour ses agents. Retirer un dossier ne supprime rien. Cela retire seulement l’accès.",
        ],
      },
      {
        id: "reach",
        heading: "Ce que les agents peuvent atteindre",
        blocks: [
          "Les agents tournent sous votre compte, celui de l’utilisateur de l’ordinateur. Leurs outils de fichiers restent dans leurs dossiers, mais une commande peut lire tout ce que vous pouvez lire\u00a0:",
          {
            list: [
              "vos fichiers et vos connexions",
              "les dossiers des autres agents, y compris ceux des autres espaces de travail, et les connexions que gardent leurs navigateurs",
              "le jeton qui connecte cet ordinateur",
              "sur un ordinateur qui fait aussi tourner agentes.chat, sa base de données et ses clés dans `.agentes`",
            ],
          },
          "agentes.chat refuse les commandes qui citent ses clés, ses jetons et les connexions enregistrées, mais c’est une règle, pas un mur. Les **Commandes** sont activées par défaut. Désactivez-les dans la question de l’app avant d’appuyer sur **Autoriser**, ou plus tard dans **Préférences\u00a0›\u00a0Outils**, où un seul interrupteur vaut pour tous les espaces de travail de l’ordinateur. Claude Code et Codex lancent leurs propres commandes dans le dossier de l’agent, selon leurs propres règles.",
          "Pour un vrai mur, utilisez un serveur Linux. Sous Debian 13, installé avec `--system`, chaque agent est un utilisateur à part. Sous Ubuntu, les agents partagent un utilisateur, `agentes`\u00a0: ils voient les dossiers les uns des autres, pas les vôtres ni ceux du serveur. Ou donnez aux agents un ordinateur rien qu’à eux.",
        ],
      },
    ],
  },
  import: {
    title: "Importer vos agents",
    summary:
      "Importez des agents depuis une autre app, ou depuis un autre espace de travail agentes.chat, avec leurs instructions, compétences, routines et mémoire.",
    sections: [
      {
        id: "comes",
        heading: "Ce qui est importé",
        blocks: [
          {
            list: [
              "Les agents, avec leur nom, leur rôle, leurs instructions et leur apparence.",
              "Les compétences, activées pour les agents qui les avaient.",
              "Les canaux publics, avec les agents qui s’y trouvent.",
              "Les routines, actives et selon leur planning. Mettez-les en pause dans **Routines** si vous le souhaitez.",
              "La mémoire : ce dont chaque agent se souvient.",
              "Les fichiers propres à chaque agent (le dossier de fichiers d’OpenBot.run, un espace de travail OpenClaw), dans un dossier à son nom dans le **Drive**. Les clés, identifiants et fichiers système restent de côté, et rien de ce qui s’y trouve déjà n’est remplacé.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "Ce qui n’est jamais importé",
        blocks: [
          "Les clés, mots de passe, identifiants et l’historique des conversations ne sont jamais importés : les agents réfléchissent avec l’IA de l’espace de travail. Certaines choses n’ont pas encore d’équivalent ici, ou ne devraient jamais voyager dans un fichier. Vous pourrez les recréer plus tard.",
          "Les fichiers et dossiers sont lus dans votre navigateur. Un lien GitHub passe par le serveur de l’espace de travail. Les fichiers de clés et d’identifiants ne sont jamais ouverts, et rien ne change tant que vous n’avez pas confirmé.",
        ],
      },
      {
        id: "other-apps",
        heading: "Depuis une autre app",
        blocks: [
          "Choisissez **Grok Bot**, **ChatGPT dots** ou **Une autre app**. Copiez la demande, collez-la dans cette app, puis rapportez ce qu’elle renvoie : déposez le fichier, ou collez toute la réponse. Où chaque app la place :",
          {
            list: [
              "**Grok Bot** : dans la conversation avec votre bot. Il répond avec le JSON : copiez toute la réponse.",
              "**ChatGPT dots** : dans une nouvelle conversation. Téléchargez le fichier qu’il crée.",
              "**Claude** : dans une nouvelle conversation, ou dans le projet de vos agents. Téléchargez le fichier qu’il crée.",
              "**Manus** : dans une nouvelle tâche. Le fichier se trouve dans les résultats de la tâche.",
              "**Rakazo** : envoyez-la à votre agent. Il répond avec le JSON : copiez toute la réponse.",
              "**OpenBot** : aucune demande nécessaire. Glissez le dossier du tenant (agents.yaml, agents/, model.yaml, skills.yaml) ou collez son lien GitHub.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "Exporter un espace de travail",
        blocks: [
          "**Paramètres › Importer et exporter › Exporter** télécharge un fichier .json, pour emmener vos agents dans un autre espace de travail ou garder une copie. Dans le fichier :",
          {
            list: [
              "Les agents, avec leurs instructions, leur modèle et leur apparence",
              "Les compétences, avec tout le SKILL.md",
              "Les canaux publics, avec leurs agents",
              "Les routines planifiées (elles arrivent actives de l’autre côté)",
              "La mémoire visible par tout l’espace de travail",
            ],
          },
          "Jamais dedans :",
          {
            list: [
              "Les clés API et les mots de passe",
              "Les connecteurs et les identifiants",
              "Les ordinateurs",
              "Les conversations, les messages et les canaux privés",
              "L’utilisation, les coûts et l’historique d’activité",
            ],
          },
          "Pour utiliser le fichier, ouvrez **Paramètres › Importer et exporter** dans l’autre espace de travail et déposez-y le .json.",
        ],
      },
    ],
  },
  wiki: {
    title: "Le wiki",
    summary: "Ce que l’entreprise sait, dans des pages reliées entre elles.",
    sections: [
      {
        id: "links",
        heading: "Liens",
        blocks: [
          "Tapez [[ pour créer un lien vers une autre page. Les rétroliens et le graphe montrent comment les pages sont reliées.",
        ],
      },
      {
        id: "agents",
        heading: "Comment les agents l’utilisent",
        blocks: ["Les agents lisent le wiki quand ils répondent. Ils n’y écrivent que si quelqu’un le leur demande."],
      },
      {
        id: "obsidian",
        heading: "Importer un coffre Obsidian",
        blocks: [
          "Déposez le dossier du coffre, ou un .zip de celui-ci, à l’étape Contexte de la configuration ou dans l’import du wiki lui-même. Les [[liens]], [[note|alias]] et [[note#section]] continuent de fonctionner. Les tags viennent du frontmatter et du texte. Les pièces jointes vont dans le Drive, et les images et fichiers intégrés deviennent des cartes sur la page. Les callouts restent des callouts. Les requêtes Dataview arrivent sous forme de texte : demandez à un agent de construire le tableau. Les canvas et les réglages d’Obsidian (.obsidian) restent de côté.",
        ],
      },
    ],
  },
  memory: {
    title: "Mémoire",
    summary: "Ce que chaque agent apprend des conversations et des corrections de l’équipe.",
    sections: [
      {
        id: "learns",
        heading: "Comment les agents apprennent",
        blocks: [
          "Les agents apprennent des conversations et des corrections de l’équipe. Ce qu’un agent sait entre dans son contexte quand c’est utile. Dans son onglet **Mémoire**, modifiez, épinglez ou archivez ce qui est faux ou dépassé.",
        ],
      },
      {
        id: "permissions",
        heading: "La mémoire ne donne aucune permission",
        blocks: [
          "Rien dans la mémoire ne permet à un agent d’en faire plus. Ce qu’il peut faire reste dans ses **Outils et accès**, et les actions sensibles demandent toujours une approbation.",
        ],
      },
      {
        id: "proposals",
        heading: "Changements proposés",
        blocks: [
          "Quand une leçon se répète, l’agent peut proposer de modifier ses propres instructions ou le contexte de l’espace de travail. Rien ne change tant que quelqu’un n’accepte pas, et le texte peut être ajusté avant. La version précédente reste dans l’historique. Une proposition refusée est gardée comme leçon, pour qu’elle ne soit pas proposée à nouveau.",
        ],
      },
    ],
  },
  approvals: {
    title: "Approbations",
    summary: "Les actions sensibles attendent une personne, une fois ou pour de bon.",
    sections: [
      {
        id: "what",
        heading: "Ce qui demande d’abord",
        blocks: [
          "Quand un agent veut fusionner, déployer, revenir en arrière, envoyer quelque chose à l’extérieur ou supprimer des données, il demande d’abord, quels que soient ses accès. La demande apparaît dans **Approbations** et dans la conversation, avec l’action exacte et sa raison.",
        ],
      },
      {
        id: "always",
        heading: "Une fois, ou toujours",
        blocks: [
          "Approuver couvre une action exacte, avec ses valeurs. Si l’agent change quoi que ce soit, il redemande.",
          "**Toujours approuver** laisse l’agent faire ce type d’action à partir de maintenant, avec n’importe quelles valeurs, sans demander. Sur la demande d’une routine, **Toujours dans cette routine** fait de même pour cette routine seulement. Aucun des deux n’est proposé pour un merge, un déploiement, un retour arrière et autres. Pour annuler, allez dans **Outils et accès** sur la page de l’agent, ou dans les réglages de la routine.",
        ],
      },
      {
        id: "who",
        heading: "Qui approuve",
        blocks: [
          {
            list: [
              "Le propriétaire de l’agent, pour ses demandes.",
              "Toute personne dont le rôle a **Approuver les actions des agents**, pour tous les agents.",
              "Les personnes que l’agent nomme en demandant, à la place de son propriétaire.",
              "Celui qui couvre quelqu’un dans **Qui approuve pour moi**, pour ce qui est demandé à cette personne. Merge, déploiement et autres actions à risque seulement quand c’est activé.",
            ],
          },
          "Une action dans la boîte mail de quelqu’un attend cette personne seule. Un nouvel accès pour un agent attend ceux qui gèrent les agents.",
          "Lodi, votre bras droit, peut aussi approuver pour vous les nouveaux agents que d’autres agents proposent et les changements de modèle, de budget et de canaux d’un agent, seulement quand c’est vous qui l’avez demandé. Qui vous couvre et ce que Lodi approuve se choisissent dans **Paramètres\u00a0›\u00a0Vous\u00a0›\u00a0Approbations**.",
        ],
      },
      {
        id: "refusing",
        heading: "Refuser",
        blocks: ["Dites pourquoi, si vous voulez : l’agent le lit, ajuste son plan et le garde comme leçon."],
      },
      {
        id: "meetings",
        heading: "Réunions",
        blocks: [
          "Les agents ne font que proposer des créneaux. Les invitations aux personnes passent toujours par celui qui a demandé.",
        ],
      },
    ],
  },
  "who-answers": {
    title: "Qui répond à un message",
    summary: "Une mention choisit l’agent. Sans mention, agentes.chat choisit pour vous, dans cet ordre.",
    sections: [
      {
        id: "order",
        heading: "Comment un message trouve son agent",
        blocks: [
          "Un message qui @mentionne un agent va à cet agent. Un message qui ne mentionne personne est lu par le premier de ceux-ci dont dispose l’espace de travail :",
          {
            list: [
              "**Jev**, un petit modèle rapide conçu pour ce genre de décision.",
              "**Un petit modèle sur l’une des clés API de l’espace de travail**, comme Claude Haiku 5.5 ou GPT-6 Luna.",
              "**Votre propre abonnement Claude ou ChatGPT**, pour les messages que vous écrivez, sur un serveur que vous gérez vous-même. Il les lit sur l’ordinateur où il est connecté, et cela prend quelques secondes.",
              "**Des règles simples** : une réponse à un agent lui revient, tout comme une relance juste après avoir échangé avec lui, ou un message dans un canal où vous êtes seul avec un agent.",
            ],
          },
          "Si aucun ne convient, aucun agent ne répond. Mentionnez un agent pour l’appeler.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "Quand agentes.chat héberge votre espace de travail, Jev est inclus. Sur un serveur que vous gérez vous-même, il utilise la clé TypeSafe du propriétaire, environ 0,0001 USD par message : [Configurer Jev](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "Pourquoi votre abonnement ne choisit que pour vos messages",
        blocks: [
          "Les abonnements Claude et ChatGPT sont personnels, donc votre abonnement ne choisit que pour les messages que vous écrivez.",
        ],
      },
      {
        id: "see",
        heading: "Voir qui a choisi",
        blocks: ["Ouvrez la coche sous un message. Sa dernière ligne indique qui a choisi les agents."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "Un modèle rapide de TypeSafe qui prend des décisions rapides pour vos agents. Sur votre propre serveur, il est facultatif, avec votre propre clé.",
    sections: [
      {
        id: "what",
        heading: "Ce qu’il fait",
        blocks: [
          {
            list: [
              "**Il choisit qui répond.** Un message sans @mention va au bon agent en moins d’une seconde, même quand vos agents réfléchissent avec un abonnement et que vous n’avez pas de clé API.",
              "**Il garde la mémoire en ordre.** Il repère une répétition ou un fait plus récent même formulés autrement : la répétition fusionne avec ce que l’agent savait, et le fait plus récent remplace l’ancien. Une fois par jour, il range le reste.",
              "**Il voit l’écran.** Dans leur navigateur et leur bureau, les agents trouvent boutons et champs à partir d’une description, regardent de plus près les petits, et vérifient sur l’image de l’écran qu’une étape a fonctionné.",
              "**Il fait lire moins.** Chaque tour ne charge que les outils dont l’agent aura probablement besoin, donc votre IA lit moins et coûte moins.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Sans lui",
        blocks: [
          "Tout continue de fonctionner, plus lentement et avec moins de soin.",
          {
            list: [
              "**Qui répond :** un petit modèle sur l’une de vos clés API choisit, comme Claude Haiku 5.5 ou GPT-6 Luna. Sans clé, l’abonnement Claude ou ChatGPT de chaque personne choisit pour les messages qu’elle écrit, en quelques secondes. Sinon, une réponse ou une relance atteint quand même son agent. Mentionnez un agent pour l’appeler. [Comment les agents sont choisis](/help/who-answers)",
              "**Mémoire :** les répétitions dans les mêmes mots fusionnent toujours. Les répétitions et mises à jour formulées autrement restent séparées.",
              "**Écran :** les agents utilisent les numéros affichés à l’écran et les noms exacts. Rien n’est lu dans les images.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "Le configurer",
        blocks: [
          {
            list: [
              "Ouvrez https://console.typesafe.ai et connectez-vous avec Google ou votre e-mail. Un nouveau compte se crée de la même façon.",
              "Ajoutez du crédit dans la console. Jev est prépayé.",
              "Ouvrez https://console.typesafe.ai/keys, créez une clé et copiez-la tout de suite.",
              "Dans agentes.chat, ouvrez **Paramètres › IA et utilisation** et collez-la sous **Jev**. Seule la personne qui a installé ce serveur la voit.",
            ],
          },
          "Sur un serveur que vous faites tourner avec Docker, vous pouvez plutôt mettre la clé dans `.env` en tant que `TYPESAFE_API_KEY`. Celle-ci l’emporte sur celle des Paramètres.",
        ],
      },
      {
        id: "cost",
        heading: "Ce qu’il coûte",
        blocks: [
          {
            list: [
              "0,042 USD par million de jetons lus par Jev. Ses réponses sont gratuites. Choisir qui répond lit environ 2 500 jetons, soit environ 0,0001 USD. Une capture d’écran fait environ 3 900 jetons.",
              "Les crédits achetés durent 12 mois. Activez la recharge automatique dans la console pour que Jev ne tombe pas à court.",
              "**Paramètres › IA et utilisation** indique combien de décisions Jev a prises ce mois-ci, et ce qu’elles ont coûté.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "Vos données",
        blocks: [
          "Ce que Jev lit pour décider :",
          {
            list: [
              "Le nom et la description du canal, le message et les quelques précédents",
              "Les noms et rôles de vos agents, le début de leurs instructions et les outils qu’ils peuvent utiliser",
              "Les éléments de mémoire qu’il compare",
              "La tâche d’un agent et le début des résultats de ses outils",
              "L’objectif d’une mission et les commandes qu’un agent veut exécuter pour elle",
              "Les outils proposés par une app connectée",
              "La page ou l’écran qu’un agent utilise, captures d’écran comprises",
            ],
          },
          "TypeSafe fait tourner Jev aux États-Unis et n’entraîne pas ses modèles sur ce que vous envoyez. Il conserve les données le temps nécessaire au fonctionnement du service. La rétention zéro est disponible dans ses offres entreprise.",
          "Politique de confidentialité de TypeSafe : https://typesafe.ai/legal/privacy-policy. Son accord de traitement des données : https://typesafe.ai/legal/data-processing.",
        ],
      },
      {
        id: "problems",
        heading: "Quand il s’arrête",
        blocks: [
          {
            list: [
              "**Clé refusée :** créez une nouvelle clé et collez-la dans **Paramètres › IA et utilisation**.",
              "**Plus de crédit :** ajoutez du crédit dans la console. Jev réessaie dans les 30 minutes, ou cliquez sur **Vérifier à nouveau**.",
              "**Occupé ou injoignable :** TypeSafe peut limiter les requêtes par seconde, ou cesser de répondre un moment. Jev reprend tout seul. Vos limites : https://console.typesafe.ai/rate-limits. Pour des limites plus élevées, écrivez à sales@typesafe.ai.",
            ],
          },
          "En attendant, les agents fonctionnent comme dans [Sans lui](/help/jev#without).",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "Applications d’IA",
    summary:
      "Confiez des tâches aux agents d’agentes.chat depuis Claude, Cursor ou une autre app MCP, sans la quitter, et recevez la réponse au même endroit.",
    sections: [
      {
        id: "what",
        heading: "Comment ça fonctionne",
        blocks: [
          "agentes.chat est un serveur MCP. Vous collez son adresse dans votre app IA, vous vous connectez avec votre compte et vous choisissez un espace de travail. Ensuite, l’app peut lister les agents et les canaux, confier une tâche à un agent en votre nom, attendre la réponse et lire les tâches récentes.",
          "Par exemple, au milieu d’une scène dans Unity ou Blender, demandez à Claude : « Demande à l’agent marketing un texte pour le lancement ». Le message apparaît dans agentes.chat comme le vôtre, marqué **via Claude**, et la réponse de l’agent revient dans Claude.",
          "L’adresse se trouve dans **Paramètres › Applications d’IA**. Elle se termine par `/mcp`.",
        ],
      },
      {
        id: "connect",
        heading: "Connecter une app",
        blocks: [
          {
            list: [
              "**Claude** (claude.ai, Claude Desktop et mobile) : dans **Personnaliser › Connecteurs** (Customize › Connectors), cliquez sur **+ Ajouter**, puis sur **Ajouter un connecteur personnalisé** (Add custom connector), nommez-le agentes.chat, collez l’adresse et cliquez sur **Continuer**. Choisissez **Se connecter maintenant** (Sign in now), cliquez sur **Ajouter** et autorisez. Avec les abonnements Team et Enterprise, le propriétaire de l’organisation Claude ajoute le connecteur dans Paramètres de l’organisation › Connecteurs, puis chaque personne clique sur **Connecter** dans Personnaliser › Connecteurs. L’abonnement gratuit de Claude permet un connecteur personnalisé.",
              "**Claude Code :** exécutez `claude mcp add --transport http --scope user agentes <adresse>`, puis tapez `/mcp`, choisissez agentes et **Authenticate**. Pour le dossier courant uniquement, retirez `--scope user`.",
              "**Cursor :** **Ajouter à Cursor** dans **Paramètres › Applications d’IA**, ou l’adresse dans `~/.cursor/mcp.json`. Cursor vous demande de vous connecter à la première utilisation.",
              '**VS Code :** **Ajouter à VS Code**, ou l’adresse dans `.vscode/mcp.json` avec `"type": "http"`.',
              "**Autres apps :** ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains et d’autres ont chacune leurs étapes dans **Connecter une app**, avec votre adresse déjà remplie.",
            ],
          },
          "Lors de la connexion, agentes.chat indique quelle app a demandé l’accès et où elle renvoie. Ne continuez que si vous venez de lancer la connexion.",
        ],
      },
      {
        id: "tools",
        heading: "Ce que l’app peut faire",
        blocks: [
          {
            list: [
              "`send_to_agent` : envoie un message de votre part à un agent, dans votre conversation privée avec lui ou dans un canal, et attend la réponse. Uniquement avec l’accès **Lire et confier des tâches aux agents**.",
              "`wait_for_reply` : continue d’attendre la réponse à une tâche.",
              "`list_agents` : les agents que vous voyez.",
              "`list_channels` : les canaux que vous lisez.",
              "`read_conversation` : les messages récents d’un canal, d’un fil ou d’une tâche.",
              "`list_recent_tasks` : les tâches que vous avez envoyées depuis des apps et ce que font les agents en ce moment.",
            ],
          },
          "L’app agit en votre nom et ne voit que ce que vous voyez. Elle n’approuve jamais les actions des agents : quand un agent s’arrête pour demander une approbation, la réponse l’indique avec un lien, et une personne décide dans agentes.chat. Elle ne modifie pas non plus les paramètres, les membres ou les permissions.",
        ],
      },
      {
        id: "workspace",
        heading: "Un espace de travail par connexion",
        blocks: [
          "Chaque connexion couvre l’espace de travail choisi lors de la connexion. Pour utiliser un autre espace de travail, reconnectez l’app et choisissez l’autre.",
          "Dans **Paramètres › Applications d’IA**, vous voyez les apps connectées, quand chacune a été utilisée, et vous pouvez déconnecter n’importe laquelle. Les personnes qui gèrent les membres voient les apps de tout l’espace de travail et peuvent aussi les déconnecter. Chaque message envoyé depuis une app apparaît dans l’Audit.",
        ],
      },
      {
        id: "tokens",
        heading: "Jetons personnels",
        blocks: [
          "Pour les scripts et les apps sans connexion OAuth, créez un jeton personnel dans **Paramètres › Applications d’IA** et envoyez-le dans l’en-tête `Authorization: Bearer`. Le jeton s’affiche une seule fois, ne fonctionne que dans l’espace de travail où il a été créé, et peut expirer dans 30 jours, 90 jours, 1 an ou jamais.",
          "Sur un serveur sans https, ailleurs que sur son propre ordinateur, utilisez un jeton personnel : la connexion OAuth exige https.",
        ],
      },
      {
        id: "limits",
        heading: "Limites",
        blocks: [
          {
            list: [
              "Jusqu’à 120 requêtes par minute et 5 000 par jour par connexion.",
              "Jusqu’à 20 messages par minute et 500 par jour par personne dans chaque espace de travail.",
              "Une attente dure jusqu’à 45 secondes. Si l’agent travaille encore, l’app attend à nouveau.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "Le texte des autres",
        blocks: [
          "Les réponses contiennent du texte écrit par des agents et des personnes dans agentes.chat. L’app reçoit ce texte marqué comme contenu, pas comme instructions, mais un texte peut quand même tenter de pousser l’app à faire autre chose. Vérifiez ce que votre app s’apprête à faire avant de confirmer.",
        ],
      },
      {
        id: "problems",
        heading: "Quand la connexion échoue",
        blocks: [
          {
            list: [
              "**Demande expirée :** la page de connexion dure 30 minutes et ne sert qu’une fois. Revenez dans l’app et reconnectez-vous.",
              "**L’app demande de se reconnecter :** la connexion a été coupée, le mot de passe a changé ou vous avez quitté l’espace de travail. Reconnectez-vous depuis l’app.",
              "**Cursor bloqué sur une ancienne connexion :** quittez Cursor, supprimez le dossier `~/.mcp-auth` et reconnectez-vous.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "Installer agentes.chat sur un serveur",
    summary:
      "Faites tourner agentes.chat sur votre propre serveur, gratuitement, pour toute votre équipe. Une commande suffit.",
    sections: [
      {
        id: "choose",
        heading: "Quelle installation choisir",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**\u00a0: pour toute équipe, accessible de partout. Nous le faisons tourner, le mettons à jour et le sauvegardons. Chaque espace de travail a son propre ordinateur, où chaque agent est un utilisateur à part.",
              "**Votre ordinateur, avec l’app**\u00a0: pour vous ou une petite équipe, accessible tant que cet ordinateur est allumé. Un Mac mini qui reste allumé fait très bien l’affaire. Vous le mettez à jour en un clic et le sauvegardez à la main. Les agents tournent sous votre compte sur cet ordinateur.",
              "**Un serveur**\u00a0: pour une équipe plus grande, en ligne en permanence. Vous le mettez à jour en trois commandes, et il peut se sauvegarder tout seul chaque jour. Sous Debian 13, chaque agent est un utilisateur à part.",
            ],
          },
          "De votre ordinateur vers un serveur\u00a0: [Passer sur un serveur](/help/run-on-your-computer#moving). Chacune peut récupérer les agents d’une autre avec [Importer vos agents](/help/import).",
        ],
      },
      {
        id: "need",
        heading: "Ce qu'il vous faut",
        blocks: [
          {
            list: [
              "Un serveur ou un VPS sous Linux 64 bits, en x64 ou arm64. Pour une petite équipe, 2 CPU, 4 Go de mémoire et 20 Go de disque sont un bon début. Sur un Mac ou un PC, [l’app fait tourner agentes.chat](/help/run-on-your-computer) sans Docker.",
              "Docker avec Compose. Sous Linux, l'installateur les ajoute s'ils manquent, après vous avoir demandé.",
              "Un moyen d'y accéder\u00a0: un compte Tailscale gratuit (le choix par défaut, privé, sans domaine ni port ouvert), ou un domaine qui pointe vers le serveur, avec les ports 80 et 443 ouverts.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "L'installer",
        blocks: [
          "Sur le serveur, lancez\u00a0:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "Il installe ce qui manque, puis pose quelques questions\u00a0: comment on y accède, l'e-mail, si ce serveur est aussi l'ordinateur de vos agents, et s'il envoie des statistiques d'utilisation anonymes. Entrée prend la réponse proposée. Il s'installe dans `/opt/agentes` (`~/agentes` pour un utilisateur qui peut déjà utiliser Docker), et la première fois il télécharge environ 2 Go.",
          "À la fin, il affiche l'adresse de votre serveur et un QR code pour votre téléphone. Le relancer ne casse rien\u00a0: il garde vos réglages et ne complète que ce qui manque.",
          "Avec Node.js 18 ou plus récent, `npx @agenteschat/setup` dans un dossier vide fait la même configuration. Sans Node, elle tourne depuis l'image de l'app, dans le dossier courant, et se termine par les commandes qui démarrent le reste\u00a0:",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "Comment on y accède",
        blocks: [
          {
            list: [
              "**Tailscale**, le choix par défaut\u00a0: du HTTPS privé à `https://agentes.<votre-tailnet>.ts.net`, seulement pour les appareils de votre réseau Tailscale. Avant d'installer, activez MagicDNS et HTTPS sur https://console.tailscale.com/admin/dns et créez une clé d'accès (auth key) sur https://console.tailscale.com/admin/settings/keys pour que la configuration vous la demande.",
              "**Un domaine public**\u00a0: tout le monde sur internet peut l'ouvrir, à `https://chat.example.com` par exemple. Faites pointer le domaine vers le serveur et ouvrez les ports 80 et 443. La configuration obtient le certificat et le renouvelle, et vous fait créer votre compte avant que le domaine soit en ligne.",
              "**Cette machine seulement**\u00a0: `http://localhost:3000`, pour l'essayer sur votre propre ordinateur.",
            ],
          },
          "Sur Tailscale, le serveur quitte votre réseau quand sa clé expire, au bout de 180 jours. Pour le garder, ouvrez le menu **⋯** du serveur sur https://console.tailscale.com/admin/machines et choisissez **Disable Key Expiry**.",
          "Les webhooks qui lancent des routines et les apps d'IA qui appellent depuis leurs propres serveurs ont besoin d'une adresse publique. Sur Tailscale, Funnel ouvre la même adresse à internet\u00a0: ajoutez Funnel à la politique de votre tailnet sur https://console.tailscale.com/admin/acls et mettez `TAILSCALE_FUNNEL=true` dans `.env`, puis lancez `docker compose up -d`.",
        ],
      },
      {
        id: "owner",
        heading: "Votre compte",
        blocks: [
          "Ouvrez l'adresse de votre serveur et inscrivez-vous\u00a0: le premier compte devient le propriétaire. Les inscriptions se ferment ensuite, et les gens entrent sur invitation, depuis **Paramètres\u00a0›\u00a0Membres et invitations**.",
          "Sur Tailscale, les personnes que vous invitez doivent aussi être dans votre tailnet. Invitez-les d'abord sur https://console.tailscale.com/admin/users puis dans agentes.chat.",
        ],
      },
      {
        id: "email",
        heading: "E-mail",
        blocks: [
          "Sans e-mail, agentes.chat écrit chaque e-mail dans son journal au lieu de l'envoyer, vous pouvez donc y copier un lien d'invitation. La réinitialisation du mot de passe reste désactivée.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "La configuration accepte votre propre serveur de messagerie (SMTP) ou la clé d'une API compatible avec Resend, comme MillionSend ou Resend. Les e-mails partent de `ping@<domaine de votre serveur>`, sauf si vous choisissez un autre expéditeur, et ce domaine doit être vérifié chez votre fournisseur d'e-mail. Pour le configurer plus tard, relancez l'installation.",
        ],
      },
      {
        id: "phone",
        heading: "Votre téléphone",
        blocks: [
          {
            list: [
              "Sur Tailscale, installez l'app Tailscale sur votre téléphone et connectez-vous à la même tailnet.",
              "Installez l'app agentes.chat.",
              "Scannez le QR code affiché par la configuration, ou celui de **Paramètres\u00a0›\u00a0Votre compte\u00a0›\u00a0Ouvrir sur votre téléphone**, qui vous connecte aussi.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "Les ordinateurs de vos agents",
        blocks: [
          "La configuration peut faire de ce serveur l'ordinateur de vos agents, où ils lancent des commandes, utilisent un navigateur et gardent leurs fichiers. Elle vous demande, et propose oui là où le serveur s'y prête bien. Sous Debian 13, chaque agent a son propre utilisateur, avec un écran. Sous Ubuntu, les agents partagent un utilisateur, `agentes`. Si vous avez dit non, relancez l'installation avec `--computer yes`\u00a0:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "D'autres ordinateurs, comme un Mac avec l'app agentes.chat ou un autre serveur, se connectent depuis **Paramètres\u00a0›\u00a0Appareils**, comme dans [Vos ordinateurs et téléphones](/help/computers). Sur Tailscale, ils rejoignent d'abord votre tailnet.",
        ],
      },
      {
        id: "backups",
        heading: "Sauvegardes et restauration",
        blocks: [
          "Votre serveur, c'est trois choses\u00a0: la base de données, les fichiers envoyés et `AGENTES_SECRET` dans `.env`. Gardez une copie de `.env` en lieu sûr, à part des sauvegardes\u00a0: sans le secret, les clés stockées dans une base restaurée sont illisibles.",
          "Pour une sauvegarde chaque jour, créez un bucket privé sur Cloudflare R2 ou un autre service compatible S3, et une clé qui peut y lire, écrire et supprimer. Ajoutez-les à `.env`, avec `backup` dans `COMPOSE_PROFILES` (`https,backup` avec un domaine public)\u00a0:",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "Puis lancez `docker compose up -d` dans le dossier d'installation. La base est sauvegardée à 03:00 UTC et chaque sauvegarde est gardée 14 jours. `docker compose run --rm backup now` en fait une tout de suite, et `docker compose run --rm backup list` les liste. Les sauvegardes ne contiennent que la base\u00a0: les fichiers envoyés, dans le volume `files`, ont besoin de leur propre copie, et le guide complet, plus bas, donne les commandes.",
          "Pour restaurer, récupérez une sauvegarde avec `docker compose run --rm -T backup fetch <nom> > agentes.dump`, puis chargez-la dans une base vide, l'app arrêtée\u00a0:",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "Restaurez dans la version qui a fait la sauvegarde, ou une plus récente.",
        ],
      },
      {
        id: "upgrades",
        heading: "Mises à jour",
        blocks: [
          "Dans le dossier d'installation, lancez\u00a0:",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "La base se met à jour toute seule au démarrage de la nouvelle version. Gardez vos réglages dans `.env` et ne modifiez jamais `docker-compose.yml`, que chaque mise à jour remplace. Sauvegardez avant un grand saut\u00a0: une base mise à jour par une version plus récente ne s'ouvre pas dans une plus ancienne.",
        ],
      },
      {
        id: "data",
        heading: "Ce qu'il envoie",
        blocks: [
          "Une fois par jour, le serveur envoie à agentes.chat des statistiques d'utilisation anonymes\u00a0: des comptes comme les personnes, les agents, la taille des machines, les tokens d'IA utilisés et la quantité de données que les navigateurs des agents envoient et reçoivent. Jamais de messages, de fichiers, de noms ni de sites. `docker compose run --rm agentes telemetry` affiche exactement ce qui serait envoyé. Le propriétaire le désactive dans **Paramètres\u00a0›\u00a0Général**, ou avec `TELEMETRY=off` dans `.env`.",
          "Les rapports d'erreur ne partent nulle part, sauf si vous mettez dans `SENTRY_DSN` un serveur compatible Sentry de votre choix. Un rapport contient l'erreur et l'endroit où elle s'est produite, jamais de messages, d'e-mails, d'adresses IP, de cookies ni de tokens.",
        ],
      },
      {
        id: "reference",
        heading: "Le guide complet",
        blocks: [
          "Tous les réglages, votre propre proxy comme nginx, l'usage sans Docker, un guide pour les agents d'IA qui l'installent seuls et que faire quand quelque chose échoue se trouvent dans `SELF_HOSTING.md`, dans le dépôt agentes.chat.",
        ],
      },
    ],
  },
};
