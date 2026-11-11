import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

export const helpPtBR: Record<HelpSlug, HelpDocument> = {
  "run-on-your-computer": {
    title: "Rodar o agentes.chat no seu computador",
    summary:
      "O app do agentes.chat também roda o próprio agentes.chat, num Mac, num PC ou num computador com Linux, para você ou uma equipe pequena.",
    sections: [
      {
        id: "how",
        heading: "Como ele roda",
        blocks: [
          "Ele roda dentro do app, com um banco de dados embutido, e guarda tudo numa pasta deste computador, a `.agentes` da sua pasta pessoal. Nada mais para instalar: sem Docker, sem banco para configurar.",
          "Ele liga junto com o app e para quando você fecha o app. Fechar pergunta antes, porque ninguém consegue usar o agentes.chat até o app abrir de novo.",
        ],
      },
      {
        id: "who",
        heading: "Para quem é",
        blocks: [
          "Você ou uma equipe pequena. Um Mac mini, um PC sobrando ou um notebook que fica ligado é um bom lugar: deixe tudo pronto como em [Manter ligado](#keep-on). Num Mac ou num PC, o app é o jeito de rodar o agentes.chat sem Docker.",
          "Para uma equipe maior, veja [Qual configuração escolher](/help/install-on-a-server#choose). Os dados podem ir para um servidor depois.",
        ],
      },
      {
        id: "keep-on",
        heading: "Manter ligado",
        blocks: [
          "Num computador que outras pessoas usam, deixe tudo pronto uma vez:",
          {
            list: [
              "**Abrir ao iniciar a sessão** liga sozinho depois da configuração.",
              "Num Mac, escolha a sua conta em **Iniciar sessão automaticamente como**, em **Ajustes do Sistema\u00a0›\u00a0Usuários e Grupos**, para o app abrir depois de reiniciar. O FileVault desliga o início de sessão automático.",
              "Num Mac, ligue **Iniciar automaticamente após falta de energia** em **Ajustes do Sistema\u00a0›\u00a0Energia**.",
              "Um Mac fica acordado enquanto o servidor roda e **Acessar pelo celular e pela equipe** está ligado. No Windows e no Linux, desligue o repouso nos ajustes de energia do sistema.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "Os agentes também trabalham aqui",
        blocks: [
          "Os agentes também trabalham neste computador, em pastas só deles, com um navegador e com o Claude Code ou o Codex quando estão instalados aqui.",
          "Os agentes aqui rodam como você. Os **Comandos** já vêm ligados, e com eles os agentes de todo workspace que usa este computador alcançam tudo o que há nele, inclusive os dados do servidor. Desligue em **Preferências\u00a0›\u00a0Ferramentas**. Veja [O que os agentes alcançam](/help/computers#reach).",
        ],
      },
      {
        id: "another-workspace",
        heading: "Emprestar para outro workspace também",
        blocks: [
          "Os workspaces do servidor que roda aqui já usam este computador, sem nada a fazer. Para um workspace de outro lugar usar também, como um no agentes.chat Cloud, abra **Preferências\u00a0›\u00a0Servidores**, aperte **Adicionar um servidor…**, entre nesse workspace e aperte **Permitir** quando o app perguntar.",
          "Cada workspace tem aqui os próprios agentes e pastas. Os **Comandos** também já vêm ligados para ele. Desligue na pergunta do app antes de apertar **Permitir**, ou depois em **Preferências\u00a0›\u00a0Ferramentas**, onde uma única chave vale para todos os workspaces deste computador.",
        ],
      },
      {
        id: "reach",
        heading: "Pelo celular e pela equipe",
        blocks: [
          "**Acessar pelo celular e pela equipe** coloca o agentes.chat no Tailscale, uma rede particular dos seus aparelhos: o seu celular e quem você convidar entram nela, e mais ninguém chega ao agentes.chat. O Tailscale é grátis: https://tailscale.com/download. Com isso desligado, o agentes.chat funciona só neste computador.",
          "Se este computador já compartilha outra coisa na porta 443 do Tailscale, o agentes.chat usa a 8443, e o endereço dele termina em `:8443`.",
        ],
      },
      {
        id: "password",
        heading: "Entrar de outros aparelhos",
        blocks: [
          "A conta dona começa sem senha: o app faz o seu login neste computador. Para entrar pelo navegador de outro computador, crie uma em **Configurações\u00a0›\u00a0Sua conta**. O app do celular se conecta escaneando o QR code em **No celular**, em **Preferências\u00a0›\u00a0Servidores**. Para isso, **Acessar pelo celular e pela equipe** precisa estar ligado.",
        ],
      },
      {
        id: "updates",
        heading: "Atualizações",
        blocks: [
          "O app procura atualizações sozinho e instala uma quando você aperta **Atualizar e reabrir** em **Preferências\u00a0›\u00a0Atualizações**. O servidor e todos os agentes reiniciam junto. O banco de dados é copiado antes e, se a versão nova não responder em 3 minutos, o app volta sozinho para a versão anterior e os dados dela.",
        ],
      },
      {
        id: "backups",
        heading: "Backup",
        blocks: [
          "Nada faz backup sozinho ainda. **Fazer backup agora**, em **Preferências\u00a0›\u00a0Servidores**, para o servidor por um instante e guarda o banco de dados, os arquivos e o `.env` em `.agentes/backups`, na sua pasta pessoal. Ele mantém os dois mais novos.",
          "De vez em quando, copie esses backups para fora deste computador, num disco ou num serviço de arquivos on-line. Eles guardam as suas chaves: mantenha em sigilo.",
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code e Codex",
        blocks: [
          "O app encontra o Claude Code e o Codex pelo `PATH` do seu shell de login, mais as pastas de costume, como `~/.local/bin`, `/opt/homebrew/bin` e `/usr/local/bin`. Se **Preferências\u00a0›\u00a0Ferramentas** mostrar **Não encontrado**, confira se `claude` ou `codex` roda numa janela nova do Terminal, depois feche e abra o app de novo.",
        ],
      },
      {
        id: "moving",
        heading: "Mudar para um servidor",
        blocks: [
          {
            list: ["Feche o app e exporte o banco de dados com a cópia do servidor que vem no próprio app. Num Mac:"],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[Instale o agentes.chat num servidor](/help/install-on-a-server), mas não inicie ainda. No `.env` dele, coloque o `AGENTES_SECRET` de `~/.agentes/.env` e depois suba só o banco de dados: `docker compose up -d postgres`.",
              "Carregue a exportação: `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "Inicie com `docker compose up -d`, copie `~/.agentes/files` para ele como o guia completo mostra e entre como antes.",
            ],
          },
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "O computador do workspace",
    summary: "Todo workspace ganha um computador só dele, sempre ligado, onde os agentes trabalham.",
    sections: [
      {
        id: "what",
        heading: "O que é",
        blocks: [
          "Um computador só deste workspace, sempre ligado. Cada agente tem nele um usuário próprio, com a própria pasta, tela, navegador e arquivos. Pela página de um agente, dá para ver ele trabalhando e assumir o controle quando precisar.",
        ],
      },
      {
        id: "own",
        heading: "Computadores e celulares próprios",
        blocks: [
          "Os agentes também podem trabalhar em computadores e celulares que você conecta: um Mac ou um PC com o app do agentes.chat, um servidor, um celular Android ou um iPhone. Veja [Computadores e celulares conectados](/help/computers).",
        ],
      },
      {
        id: "plans",
        heading: "Os seus planos de IA",
        blocks: [
          "Os agentes podem pensar com o seu próprio plano de IA, como Claude, ChatGPT, GLM ou Kimi, com login neste computador: sem chave de API. A conta fica neste computador, e o agentes.chat nunca vê a senha nem o acesso.",
          "Os planos Google AI Pro e Ultra não funcionam aqui: os termos do Google não permitem usá-los em outros produtos. Uma chave de API do Gemini funciona.",
        ],
      },
      {
        id: "size",
        heading: "O tamanho",
        blocks: ["As CPUs, a memória e o disco aparecem em **Configurações\u00a0›\u00a0Dispositivos**."],
      },
      {
        id: "trouble",
        heading: "Se ele parar de responder",
        blocks: ["Costuma voltar em poucos minutos, e já estamos cuidando: não há nada a fazer do seu lado."],
      },
    ],
  },
  computers: {
    title: "Seus computadores e celulares",
    summary:
      "Traga um Mac, um PC, um computador com Linux, um servidor ou um celular, e os agentes trabalham nele. Tanto no agentes.chat Cloud quanto num servidor próprio.",
    sections: [
      {
        id: "app",
        heading: "Pelo app do agentes.chat",
        blocks: [
          "Instale o app no computador, abra e entre no seu workspace. Ele pergunta **Deixar os agentes de <workspace> usarem este Mac?** (este PC no Windows, este computador no Linux). Escolha quem pode usar e aperte **Permitir**. Só isso.",
          "Já entrou? Ligue o workspace em **Preferências\u00a0›\u00a0Geral**, no cartão **Agentes**.",
        ],
      },
      {
        id: "web",
        heading: "Pelo site",
        blocks: [
          "Em **Configurações\u00a0›\u00a0Dispositivos**, aperte **Conectar um dispositivo**:",
          {
            list: [
              "**Este Mac** ou **Este PC**: abre o app, que pergunta antes.",
              "**Outro computador**: instale o app nele, entre com a sua conta e aperte **Permitir**. Ele aparece aqui sozinho.",
              "**Um servidor ou VPS**: rode uma linha no terminal dele e depois deixe ele entrar. A linha vale uma vez, por 10 minutos.",
            ],
          },
          "O app se conecta com um clique só a um endereço com https, como um do Tailscale terminado em `.ts.net`. Num endereço http simples, use a linha do terminal.",
        ],
      },
      {
        id: "phones",
        heading: "Celulares",
        blocks: [
          "Um celular Android se conecta por qualquer computador já conectado: por cabo ou, no Android 14 ou mais novo com a atualização de segurança de maio de 2026, pelo Wi-Fi. Um iPhone se conecta por um Mac com o app e o Xcode, e o app prepara o resto. Os dois começam em **Conectar um dispositivo**.",
        ],
      },
      {
        id: "who",
        heading: "Quem pode usar",
        blocks: [
          "Um dispositivo novo é só seu: **Só eu** quer dizer você e os agentes que trabalham para você. Abra para todo o workspace, ou para algumas pessoas e papéis, na hora de permitir ou depois, na página dele em **Configurações\u00a0›\u00a0Dispositivos**.",
        ],
      },
      {
        id: "open",
        heading: "Enquanto o app está aberto",
        blocks: [
          "Os agentes trabalham num computador só enquanto o app roda nele e o computador está acordado. Quando o app perguntar, deixe marcado **Deixar pronto: abrir o agentes.chat ao iniciar a sessão**. Um computador desligado ou em repouso aparece como **Offline**, e os agentes esperam ele voltar.",
        ],
      },
      {
        id: "pausing",
        heading: "Pausar e desconectar",
        blocks: [
          "No computador, o ícone do agentes.chat perto do relógio pausa os agentes de todos os workspaces. Em **Preferências\u00a0›\u00a0Geral**, a chave de cada workspace pausa só aquele, e **Sair** desconecta. Nada novo começa enquanto está pausado, e o que já rodava termina. Desconectar mantém as pastas dos agentes no disco.",
          "Pelo site, **Remover** na página do dispositivo desconecta ele.",
        ],
      },
      {
        id: "organizations",
        heading: "Vários workspaces, um computador",
        blocks: [
          "Entre em cada workspace no mesmo app e aperte **Permitir** para cada um. Workspaces no agentes.chat Cloud e em servidores próprios podem dividir um computador (app 0.6.1 ou mais novo). Cada um tem ali os próprios agentes e pastas, e desconectar um não mexe nos outros.",
          "Um servidor que o app roda no próprio computador já está conectado e não precisa de nada. Para emprestar esse computador também a um workspace de outro lugar, veja [Emprestar para outro workspace também](/help/run-on-your-computer#another-workspace).",
          "Usa o app num notebook só como uma janela para o workspace? Quando ele pedir para deixar os agentes usarem o notebook, **Agora não** mantém só a janela.",
        ],
      },
      {
        id: "folders",
        heading: "Pastas",
        blocks: [
          "Cada agente sempre tem a própria pasta, em `~/agentes/<workspace>`. Pastas a mais se liberam no próprio computador, nunca pelo site: no app, em **Preferências\u00a0›\u00a0Pastas**, ou com `agentes-runner folders allow` num servidor. Cada workspace libera as próprias pastas: o que você libera para um vale só para os agentes dele. Remover uma pasta não apaga nada. Só tira o acesso.",
        ],
      },
      {
        id: "reach",
        heading: "O que os agentes alcançam",
        blocks: [
          "Os agentes rodam como você, o usuário do computador. As ferramentas de arquivo deles ficam nas pastas deles, mas um comando lê tudo o que você lê:",
          {
            list: [
              "os seus arquivos e logins",
              "as pastas de outros agentes, inclusive as de outros workspaces, e os logins que os navegadores deles guardam",
              "o token que conecta o computador",
              "num computador que também roda o agentes.chat, o banco de dados e as chaves dele em `.agentes`",
            ],
          },
          "O agentes.chat recusa comandos que citam as chaves, os tokens e os logins, mas isso é uma regra, não uma parede. Os **Comandos** já vêm ligados. Desligue na pergunta do app antes de apertar **Permitir**, ou depois em **Preferências\u00a0›\u00a0Ferramentas**, onde uma única chave vale para todos os workspaces do computador. O Claude Code e o Codex rodam os próprios comandos na pasta do agente, com as próprias regras.",
          "Para uma parede de verdade, use um servidor Linux. No Debian 13, instalado com `--system`, cada agente é um usuário só dele. No Ubuntu, os agentes dividem um usuário, `agentes`: eles veem as pastas uns dos outros, não as suas nem as do servidor. Ou dê aos agentes um computador só deles.",
        ],
      },
    ],
  },
  import: {
    title: "Trazer os seus agentes",
    summary:
      "Traga agentes de outro app, ou de outro workspace do agentes.chat, com instruções, skills, rotinas e memória.",
    sections: [
      {
        id: "comes",
        heading: "O que vem junto",
        blocks: [
          {
            list: [
              "Agentes, com nome, papel, instruções e aparência.",
              "Skills, ligadas para os agentes que as tinham.",
              "Canais públicos, com os agentes dentro.",
              "Rotinas, ativas e no horário delas. Dá para pausar em **Rotinas** quando quiser.",
              "Memória: o que cada agente lembra.",
              "Os arquivos de cada agente (a pasta files do OpenBot.run, o workspace do OpenClaw), numa pasta com o nome dele no **Drive**. Chaves, logins e arquivos do sistema ficam de fora, e o que já estiver lá não é substituído.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "O que nunca vem",
        blocks: [
          "Chaves, senhas, logins e histórico de conversa nunca vêm: os agentes pensam com a IA do workspace. Algumas coisas ainda não têm equivalente aqui, ou nunca devem viajar num arquivo. Dá para recriar depois.",
          "Arquivos e pastas são lidos no seu navegador. Um link do GitHub passa pelo servidor do workspace. Arquivos de chaves e de login nunca são abertos, e nada muda até você confirmar.",
        ],
      },
      {
        id: "other-apps",
        heading: "De outro app",
        blocks: [
          "Escolha **Grok Bot**, **ChatGPT dots** ou **Outro app**. Copie o pedido, cole nesse app e traga o que ele devolver: solte o arquivo ou cole a resposta inteira. Onde cada app entrega:",
          {
            list: [
              "**Grok Bot**: na conversa com o seu bot. Ele responde com o JSON: copie a resposta inteira.",
              "**ChatGPT dots**: num chat novo. Baixe o arquivo que ele criar.",
              "**Claude**: numa conversa nova, ou no projeto dos seus agentes. Baixe o arquivo que ele criar.",
              "**Manus**: numa tarefa nova. O arquivo fica nos resultados da tarefa.",
              "**Rakazo**: mande para o seu agente. Ele responde com o JSON: copie a resposta inteira.",
              "**OpenBot**: sem pedido. Arraste a pasta do tenant (agents.yaml, agents/, model.yaml, skills.yaml) ou cole o link do GitHub dela.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "Exportar um workspace",
        blocks: [
          "**Configurações\u00a0›\u00a0Importar e exportar\u00a0›\u00a0Exportar** baixa um arquivo .json, para levar os agentes a outro workspace ou guardar uma cópia. Vai no arquivo:",
          {
            list: [
              "Agentes, com instruções, modelo e aparência",
              "Skills, com o SKILL.md inteiro",
              "Canais públicos, com os agentes de cada um",
              "Rotinas agendadas (chegam ativas do outro lado)",
              "A memória que todo mundo no workspace pode ver",
            ],
          },
          "Nunca vai:",
          {
            list: [
              "Chaves de API e senhas",
              "Conectores e logins",
              "Computadores",
              "Conversas, mensagens e canais privados",
              "Uso, custos e histórico de ações",
            ],
          },
          "Para usar o arquivo, abra **Configurações\u00a0›\u00a0Importar e exportar** no outro workspace e solte o .json.",
        ],
      },
    ],
  },
  wiki: {
    title: "A wiki",
    summary: "O que a empresa sabe, em páginas ligadas umas às outras.",
    sections: [
      {
        id: "links",
        heading: "Links",
        blocks: ["Digite [[ para ligar outra página. Os backlinks e o grafo mostram como as páginas se conectam."],
      },
      {
        id: "agents",
        heading: "Como os agentes usam",
        blocks: ["Os agentes leem a wiki quando respondem. Escrevem nela só quando alguém pede."],
      },
      {
        id: "obsidian",
        heading: "Trazer uma vault do Obsidian",
        blocks: [
          "Solte a pasta da vault, ou um .zip dela, no passo Contexto da configuração ou na importação da própria wiki. [[Links]], [[nota|apelido]] e [[nota#seção]] continuam funcionando. As tags vêm do frontmatter e do texto. Os anexos vão para o Drive, e imagens e arquivos incorporados viram cards na página. Callouts continuam callouts. Consultas do Dataview chegam como texto: peça a um agente para montar a tabela. Canvases e os ajustes do Obsidian (.obsidian) ficam de fora.",
        ],
      },
    ],
  },
  memory: {
    title: "Memória",
    summary: "O que cada agente aprende com as conversas e as correções do time.",
    sections: [
      {
        id: "learns",
        heading: "Como os agentes aprendem",
        blocks: [
          "Os agentes aprendem com as conversas e com as correções do time. O que um agente sabe entra no contexto dele quando for relevante. Na aba **Memória**, edite, fixe ou arquive o que estiver errado ou velho.",
        ],
      },
      {
        id: "permissions",
        heading: "Memória não dá permissão",
        blocks: [
          "Nada na memória deixa um agente fazer mais. O que ele pode fazer continua em **Ferramentas e acesso**, e ações sensíveis sempre pedem aprovação.",
        ],
      },
      {
        id: "proposals",
        heading: "Mudanças propostas",
        blocks: [
          "Quando uma lição se repete, o agente pode propor mudar as próprias instruções ou o contexto do workspace. Nada muda sem alguém aceitar, e dá para ajustar o texto antes. A versão anterior fica no histórico. Uma proposta recusada vira lição, para não ser proposta de novo.",
        ],
      },
    ],
  },
  approvals: {
    title: "Aprovações",
    summary: "Ações sensíveis esperam uma pessoa, uma vez ou para sempre.",
    sections: [
      {
        id: "what",
        heading: "O que pede antes",
        blocks: [
          "Quando um agente quiser fazer merge, deploy, rollback, mandar algo para fora ou apagar dados, ele pede antes, qualquer que seja o acesso dele. O pedido aparece em **Aprovações** e na conversa, com a ação exata e o porquê.",
        ],
      },
      {
        id: "always",
        heading: "Uma vez, ou sempre",
        blocks: [
          "Aprovar vale para uma ação exata, com os valores dela. Se o agente mudar qualquer coisa, ele pede de novo.",
          "**Aprovar sempre** deixa o agente fazer esse tipo de ação daqui em diante, com quaisquer valores, sem pedir. No pedido de uma rotina, **Sempre nesta rotina** faz o mesmo só para ela. Nenhum dos dois aparece para merge, deploy, rollback e afins. Para desfazer, vá em **Ferramentas e acesso** na página do agente, ou nos ajustes da rotina.",
        ],
      },
      {
        id: "who",
        heading: "Quem aprova",
        blocks: [
          {
            list: [
              "Quem é responsável pelo agente, nos pedidos dele.",
              "Quem tem um papel com **Aprovar ações dos agentes**, em todos os agentes.",
              "As pessoas que o agente nomeia ao pedir, no lugar do responsável.",
              "Quem cobre alguém em **Quem aprova por mim**, no que é pedido a essa pessoa. Merge, deploy e outras ações de risco só quando isso está ligado.",
            ],
          },
          "Uma ação na caixa de e-mail de alguém espera só essa pessoa. Um acesso novo para um agente espera quem gerencia agentes.",
          "O Lodi, seu braço direito, também pode aprovar por você os agentes novos que outros agentes propõem e mudanças de modelo, orçamento e canais de um agente, só quando foi você quem pediu. Quem cobre você e o que o Lodi aprova ficam em **Configurações\u00a0›\u00a0Você\u00a0›\u00a0Aprovações**.",
        ],
      },
      {
        id: "refusing",
        heading: "Recusar",
        blocks: ["Diga o porquê, se quiser: o agente lê, ajusta o plano e guarda como lição."],
      },
      {
        id: "meetings",
        heading: "Reuniões",
        blocks: ["Agentes só propõem horários. Convites para pessoas sempre passam por quem pediu."],
      },
    ],
  },
  "who-answers": {
    title: "Quem responde uma mensagem",
    summary: "Uma menção escolhe o agente. Sem ela, o agentes.chat escolhe por você, nesta ordem.",
    sections: [
      {
        id: "order",
        heading: "Como uma mensagem encontra o seu agente",
        blocks: [
          "Uma mensagem que @menciona um agente vai para esse agente. Uma mensagem que não menciona ninguém é lida pelo primeiro destes que o workspace tiver:",
          {
            list: [
              "**Jev**, um modelo pequeno e rápido, feito para decisões como esta.",
              "**Um modelo pequeno numa das chaves de API do workspace**, como o Claude Haiku 5.5 ou o GPT-6 Luna.",
              "**O seu próprio plano do Claude ou do ChatGPT**, para as mensagens que você escreve, num servidor que você mesmo roda. Ele as lê no computador onde está conectado e leva alguns segundos.",
              "**Regras simples**: uma resposta a um agente vai para ele, e também uma continuação logo depois de você falar com ele, ou uma mensagem num canal onde você está sozinho com um agente.",
            ],
          },
          "Quando nada disso serve, nenhum agente responde. Mencione um agente para chamá-lo.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "Quando o agentes.chat hospeda o seu workspace, o Jev está incluído. Num servidor que você mesmo roda, ele usa a chave da TypeSafe do dono, cerca de US$ 0,0001 por mensagem: [Configurar o Jev](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "Por que o seu plano só escolhe nas suas mensagens",
        blocks: [
          "Os planos do Claude e do ChatGPT são pessoais, então o seu plano só escolhe nas mensagens que você escreve.",
        ],
      },
      {
        id: "see",
        heading: "Ver quem escolheu",
        blocks: ["Abra o visto embaixo de uma mensagem. A última linha diz quem escolheu os agentes."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "Um modelo rápido da TypeSafe que toma decisões rápidas pelos seus agentes. No seu próprio servidor ele é opcional, com uma chave sua.",
    sections: [
      {
        id: "what",
        heading: "O que ele faz",
        blocks: [
          {
            list: [
              "**Escolhe quem responde.** Uma mensagem sem @menção vai para o agente certo em menos de um segundo, mesmo quando os agentes pensam com um plano e você não tem chave de API.",
              "**Organiza a memória.** Ele percebe uma repetição ou um fato novo mesmo com outras palavras: a repetição se junta ao que o agente já sabia, e o fato novo substitui o antigo. Uma vez por dia ele organiza o resto.",
              "**Enxerga a tela.** No navegador e no desktop, os agentes acham botões e campos pela descrição, olham de perto os pequenos e conferem na imagem da tela se um passo deu certo.",
              "**Lê menos.** A cada vez, o agente carrega só as ferramentas de que deve precisar. A sua IA lê menos e custa menos.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Sem ele",
        blocks: [
          "Tudo continua funcionando, mais devagar e com menos cuidado.",
          {
            list: [
              "**Quem responde:** um modelo pequeno numa das suas chaves de API escolhe, como o Claude Haiku 5.5 ou o GPT-6 Luna. Sem chave, o plano do Claude ou do ChatGPT de cada pessoa escolhe nas mensagens que ela escreve, em alguns segundos. Fora isso, uma resposta ou uma continuação ainda chega ao agente. Mencione um agente para chamá-lo. [Como os agentes são escolhidos](/help/who-answers)",
              "**Memória:** repetições com as mesmas palavras ainda se juntam. Repetições e novidades ditas de outro jeito ficam separadas.",
              "**Tela:** os agentes usam os números mostrados na tela e os nomes exatos. Nada é lido de imagens.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "Como configurar",
        blocks: [
          {
            list: [
              "Abra https://console.typesafe.ai e entre com o Google ou o seu e-mail. Uma conta nova é criada do mesmo jeito.",
              "Adicione crédito no console. O Jev é pré-pago.",
              "Abra https://console.typesafe.ai/keys, crie uma chave e copie na hora.",
              "No agentes.chat, abra **Configurações\u00a0›\u00a0IA e uso** e cole em **Jev**. Só quem configurou este servidor vê essa parte.",
            ],
          },
          "Num servidor que você roda com Docker, dá para colocar a chave no `.env` como `TYPESAFE_API_KEY`. Essa vale mais que a das Configurações.",
        ],
      },
      {
        id: "cost",
        heading: "Quanto custa",
        blocks: [
          {
            list: [
              "US$ 0,042 por milhão de tokens que o Jev lê. As respostas são grátis. Escolher quem responde lê cerca de 2.500 tokens, ou seja, cerca de US$ 0,0001. Uma captura de tela tem cerca de 3.900 tokens.",
              "O crédito comprado vale por 12 meses. Ligue a recarga automática no console para o Jev não ficar sem crédito.",
              "**Configurações\u00a0›\u00a0IA e uso** mostra quantas decisões o Jev tomou no mês e quanto custaram.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "Os seus dados",
        blocks: [
          "O que o Jev lê para decidir:",
          {
            list: [
              "O nome e a descrição do canal, a mensagem e as poucas antes dela",
              "Os nomes e papéis dos agentes, o começo das instruções deles e as ferramentas que eles podem usar",
              "Os itens de memória que ele compara",
              "A tarefa de um agente e o começo dos resultados das ferramentas",
              "O objetivo de uma missão e os comandos que um agente quer rodar nela",
              "As ferramentas que um app conectado oferece",
              "A página ou a tela que um agente está usando, inclusive capturas",
            ],
          },
          "A TypeSafe roda o Jev nos Estados Unidos e não treina os modelos dela com o que você envia. Ela guarda os dados pelo tempo necessário para operar o serviço. A TypeSafe oferece retenção zero nos planos enterprise.",
          "Política de privacidade da TypeSafe: https://typesafe.ai/legal/privacy-policy. Contrato de tratamento de dados: https://typesafe.ai/legal/data-processing.",
        ],
      },
      {
        id: "problems",
        heading: "Quando ele para",
        blocks: [
          {
            list: [
              "**Chave recusada:** crie uma chave nova e cole em **Configurações\u00a0›\u00a0IA e uso**.",
              "**Sem crédito:** adicione crédito no console. O Jev tenta de novo em até 30 minutos, ou clique em **Verificar de novo**.",
              "**Ocupado ou fora do ar:** a TypeSafe pode limitar os pedidos por segundo, ou parar de responder por um tempo. O Jev volta sozinho. Os seus limites: https://console.typesafe.ai/rate-limits. Para limites maiores, escreva para sales@typesafe.ai.",
            ],
          },
          "Enquanto isso, os agentes trabalham como em [Sem ele](/help/jev#without).",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "Apps de IA",
    summary:
      "Peça tarefas aos agentes do agentes.chat pelo Claude, Cursor ou outro app com MCP, sem sair dele, e receba a resposta ali mesmo.",
    sections: [
      {
        id: "what",
        heading: "Como funciona",
        blocks: [
          "O agentes.chat é um servidor MCP. Você cola o endereço dele no seu app de IA, entra com a sua conta e escolhe um workspace. Daí em diante, o app pode listar os agentes e os canais, mandar uma tarefa a um agente em seu nome, esperar a resposta e ler as tarefas recentes.",
          'Por exemplo, no meio de uma cena no Unity ou no Blender, peça ao Claude: "Peça ao agente de marketing um texto para o lançamento". A mensagem aparece no agentes.chat como sua, marcada com **via Claude**, e a resposta do agente volta para o Claude.',
          "O endereço está em **Configurações\u00a0›\u00a0Apps de IA**. Ele termina em `/mcp`.",
        ],
      },
      {
        id: "connect",
        heading: "Conectar um app",
        blocks: [
          {
            list: [
              "**Claude** (claude.ai, Claude Desktop e celular): em **Personalizar\u00a0›\u00a0Conectores** (Customize\u00a0›\u00a0Connectors), clique em **+ Adicionar** e em **Adicionar conector personalizado** (Add custom connector), dê o nome agentes.chat, cole o endereço e clique em **Continuar**. Escolha **Entrar agora** (Sign in now), clique em **Adicionar** e autorize. Em planos Team e Enterprise, o dono da organização no Claude adiciona o conector em Configurações da organização\u00a0›\u00a0Conectores, e cada pessoa clica em **Conectar** em Personalizar\u00a0›\u00a0Conectores. No plano grátis do Claude, cabe um conector personalizado.",
              "**Claude Code:** rode `claude mcp add --transport http --scope user agentes <endereço>`, depois digite `/mcp`, escolha agentes e **Authenticate**. Para só a pasta atual, tire `--scope user`.",
              "**Cursor:** **Adicionar ao Cursor** em **Configurações\u00a0›\u00a0Apps de IA**, ou o endereço em `~/.cursor/mcp.json`. O Cursor pede para entrar na primeira vez que usar.",
              '**VS Code:** **Adicionar ao VS Code**, ou o endereço em `.vscode/mcp.json` com `"type": "http"`.',
              "**Outros apps:** ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains e outros têm cada um seus passos em **Conectar um app**, com o seu endereço já preenchido.",
            ],
          },
          "Na hora de entrar, o agentes.chat mostra qual app pediu o acesso e para onde ele volta. Continue só se você acabou de começar a conexão.",
        ],
      },
      {
        id: "tools",
        heading: "O que o app pode fazer",
        blocks: [
          {
            list: [
              "`send_to_agent`: manda uma mensagem sua a um agente, na conversa privada com ele ou num canal, e espera a resposta. Só com o acesso **Ler e mandar tarefas aos agentes**.",
              "`wait_for_reply`: continua esperando a resposta de uma tarefa.",
              "`list_agents`: os agentes que você vê.",
              "`list_channels`: os canais que você lê.",
              "`read_conversation`: as mensagens recentes de um canal, de uma thread ou de uma tarefa.",
              "`list_recent_tasks`: as tarefas que você mandou pelos apps e o que os agentes estão fazendo agora.",
            ],
          },
          "O app age como você e vê só o que você vê. Ele nunca aprova ações dos agentes: quando um agente para e pede aprovação, a resposta diz isso e traz o link, e uma pessoa decide no agentes.chat. Ele também não muda configurações, membros ou permissões.",
        ],
      },
      {
        id: "workspace",
        heading: "Um workspace por conexão",
        blocks: [
          "Cada conexão vale para o workspace escolhido ao entrar. Para usar outro workspace, conecte o app de novo e escolha o outro.",
          "Em **Configurações\u00a0›\u00a0Apps de IA** você vê os apps conectados, quando cada um foi usado, e desconecta qualquer um. Quem gerencia os membros vê os apps de todo o workspace e também pode desconectar. Cada mensagem mandada por um app aparece na Auditoria.",
        ],
      },
      {
        id: "tokens",
        heading: "Tokens pessoais",
        blocks: [
          "Para scripts e apps sem login OAuth, crie um token pessoal em **Configurações\u00a0›\u00a0Apps de IA** e mande no cabeçalho `Authorization: Bearer`. O token aparece uma vez só, vale só no workspace onde foi criado e pode ter validade de 30 dias, 90 dias, 1 ano ou nenhuma.",
          "Num servidor sem https, fora do próprio computador, use um token pessoal: o login OAuth pede https.",
        ],
      },
      {
        id: "limits",
        heading: "Limites",
        blocks: [
          {
            list: [
              "Até 120 pedidos por minuto e 5.000 por dia em cada conexão.",
              "Até 20 mensagens por minuto e 500 por dia de cada pessoa em cada workspace.",
              "Uma espera dura até 45 segundos. Quando o agente ainda está trabalhando, o app espera de novo.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "Textos de outras pessoas",
        blocks: [
          "As respostas trazem textos escritos por agentes e por pessoas no agentes.chat. O app recebe esses textos marcados como conteúdo, não como instruções, mas um texto pode tentar convencer o app a fazer outra coisa. Confira o que o seu app vai fazer antes de confirmar.",
        ],
      },
      {
        id: "problems",
        heading: "Quando não conecta",
        blocks: [
          {
            list: [
              "**Pedido expirado:** a página de entrada vale 30 minutos e serve uma vez. Volte ao app e conecte de novo.",
              "**O app pede para entrar de novo:** a conexão foi desconectada, a senha mudou ou você saiu do workspace. Entre de novo pelo app.",
              "**Cursor preso num login antigo:** feche o Cursor, apague a pasta `~/.mcp-auth` e conecte de novo.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "Instalar o agentes.chat num servidor",
    summary: "Rode o agentes.chat num servidor seu, de graça, para a equipe toda. Um comando deixa tudo pronto.",
    sections: [
      {
        id: "choose",
        heading: "Qual configuração escolher",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**: para qualquer equipe, acessível de qualquer lugar. Nós rodamos, atualizamos e fazemos o backup. Cada workspace ganha um computador próprio, onde cada agente é um usuário só dele.",
              "**O seu computador, com o app**: para você ou uma equipe pequena, acessível enquanto esse computador estiver ligado. Um Mac mini que fica ligado funciona bem. Você atualiza com um clique e faz o backup na mão. Os agentes rodam como você nesse computador.",
              "**Um servidor**: para uma equipe maior, no ar o tempo todo. Você atualiza com três comandos, e ele pode fazer backup todo dia sozinho. No Debian 13, cada agente é um usuário só dele.",
            ],
          },
          "Do seu computador para um servidor: [Mudar para um servidor](/help/run-on-your-computer#moving). Qualquer um deles pode trazer agentes de outro com [Trazer os seus agentes](/help/import).",
        ],
      },
      {
        id: "need",
        heading: "O que você precisa",
        blocks: [
          {
            list: [
              "Um servidor ou VPS com Linux de 64 bits, em x64 ou arm64. Para uma equipe pequena, 2 CPUs, 4 GB de memória e 20 GB de disco são um bom começo. Num Mac ou num PC, [o app roda o agentes.chat](/help/run-on-your-computer) sem Docker.",
              "Docker com Compose. No Linux, o instalador coloca os dois quando faltam, depois de perguntar.",
              "Um jeito de chegar: uma conta grátis no Tailscale (o padrão, particular, sem domínio e sem porta aberta) ou um domínio apontado para o servidor, com as portas 80 e 443 abertas.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "Instalar",
        blocks: [
          "No servidor, rode:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "Ele instala o que falta e faz algumas perguntas: como as pessoas chegam até ele, o e-mail, se este servidor também é o computador dos agentes e se manda estatísticas de uso anônimas. Enter aceita a resposta sugerida. Ele fica em `/opt/agentes` (`~/agentes` para quem já usa o Docker sem root) e, na primeira vez, baixa cerca de 2 GB.",
          "No fim, ele mostra o endereço do servidor e um QR code para o celular. Rodar de novo não estraga nada: ele mantém os ajustes e só completa o que falta.",
          "Com Node.js 18 ou mais novo, `npx @agenteschat/setup` numa pasta vazia é a mesma configuração. Sem Node, ela roda pela imagem do app, na pasta atual, e termina com os comandos que sobem o resto:",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "Como as pessoas chegam",
        blocks: [
          {
            list: [
              "**Tailscale**, o padrão: HTTPS particular em `https://agentes.<sua-tailnet>.ts.net`, só para os aparelhos da sua rede no Tailscale. Antes de instalar, ligue MagicDNS e HTTPS em https://console.tailscale.com/admin/dns e crie uma chave de acesso (auth key) em https://console.tailscale.com/admin/settings/keys para a configuração pedir.",
              "**Um domínio público**: qualquer pessoa na internet abre, em `https://chat.example.com`, por exemplo. Aponte o domínio para o servidor e abra as portas 80 e 443. A configuração pega o certificado e renova sozinha, e pede para você criar a sua conta antes de o domínio entrar no ar.",
              "**Só esta máquina**: `http://localhost:3000`, para experimentar no seu próprio computador.",
            ],
          },
          "No Tailscale, o servidor sai da sua rede quando a chave dele vence, depois de 180 dias. Para mantê-lo, abra o menu **⋯** do servidor em https://console.tailscale.com/admin/machines e escolha **Disable Key Expiry**.",
          "Webhooks que iniciam rotinas e apps de IA que chamam dos próprios servidores precisam de um endereço público. No Tailscale, o Funnel abre o mesmo endereço para a internet: adicione o Funnel à política da sua tailnet em https://console.tailscale.com/admin/acls e defina `TAILSCALE_FUNNEL=true` no `.env`, depois rode `docker compose up -d`.",
        ],
      },
      {
        id: "owner",
        heading: "A sua conta",
        blocks: [
          "Abra o endereço do servidor e crie a sua conta: a primeira conta vira a dona. Depois disso o cadastro fecha, e as pessoas entram por convite, em **Configurações\u00a0›\u00a0Membros e convites**.",
          "No Tailscale, quem você convida também precisa estar na sua tailnet. Convide primeiro em https://console.tailscale.com/admin/users e depois no agentes.chat.",
        ],
      },
      {
        id: "email",
        heading: "E-mail",
        blocks: [
          "Sem e-mail, o agentes.chat escreve cada e-mail no log em vez de enviar, então dá para copiar um link de convite de lá. Redefinir a senha fica desligado.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "A configuração aceita o seu próprio servidor de e-mail (SMTP) ou a chave de uma API compatível com o Resend, como o MillionSend ou o próprio Resend. Os e-mails saem de `ping@<domínio do servidor>`, a não ser que você escolha outro remetente, e esse domínio precisa estar verificado no seu provedor de e-mail. Para configurar depois, rode a instalação de novo.",
        ],
      },
      {
        id: "phone",
        heading: "No celular",
        blocks: [
          {
            list: [
              "No Tailscale, instale o app do Tailscale no celular e entre na mesma tailnet.",
              "Instale o app do agentes.chat.",
              "Escaneie o QR code que a configuração mostrou, ou o de **Configurações\u00a0›\u00a0Sua conta\u00a0›\u00a0Abrir no celular**, que também já faz o login.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "Os computadores dos agentes",
        blocks: [
          "A configuração pode fazer deste servidor também o computador dos agentes, onde eles rodam comandos, usam um navegador e guardam os arquivos. Ela pergunta, e sugere sim onde o servidor dá conta. No Debian 13, cada agente ganha um usuário só dele, com uma tela. No Ubuntu, os agentes dividem um usuário, `agentes`. Se você disse não, rode a instalação de novo com `--computer yes`:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "Outros computadores, como um Mac com o app do agentes.chat ou outro servidor, se conectam em **Configurações\u00a0›\u00a0Dispositivos**, como em [Seus computadores e celulares](/help/computers). No Tailscale, eles entram na sua tailnet antes.",
        ],
      },
      {
        id: "backups",
        heading: "Backup e restauração",
        blocks: [
          "O seu servidor é três coisas: o banco de dados, os arquivos enviados e o `AGENTES_SECRET` do `.env`. Guarde uma cópia do `.env` num lugar seguro, longe dos backups: sem o segredo, as chaves guardadas num banco restaurado não podem ser lidas.",
          "Para um backup por dia, crie um bucket particular no Cloudflare R2 ou em outro serviço compatível com S3, e uma chave que leia, grave e apague nele. Coloque os dois no `.env`, com `backup` no `COMPOSE_PROFILES` (`https,backup` com um domínio público):",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "Depois rode `docker compose up -d` na pasta da instalação. O banco é copiado às 03:00 UTC, e cada cópia fica 14 dias. `docker compose run --rm backup now` faz uma na hora, e `docker compose run --rm backup list` lista todas. As cópias têm só o banco: os arquivos enviados, no volume `files`, precisam de uma cópia à parte, e o guia completo, mais abaixo, tem os comandos.",
          "Para restaurar, baixe uma cópia com `docker compose run --rm -T backup fetch <nome> > agentes.dump` e carregue num banco vazio, com o app parado:",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "Restaure na versão que fez a cópia ou numa mais nova.",
        ],
      },
      {
        id: "upgrades",
        heading: "Atualizar",
        blocks: [
          "Na pasta da instalação, rode:",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "O banco se atualiza sozinho quando a versão nova sobe. Deixe os seus ajustes no `.env` e nunca edite o `docker-compose.yml`, que cada atualização substitui. Faça um backup antes de um salto grande: um banco que uma versão mais nova atualizou não abre numa mais antiga.",
        ],
      },
      {
        id: "data",
        heading: "O que ele envia",
        blocks: [
          "Uma vez por dia, o servidor manda ao agentes.chat estatísticas de uso anônimas: contagens como pessoas, agentes, tamanho das máquinas, tokens de IA usados e quantos dados os navegadores dos agentes enviam e recebem. Nunca mensagens, arquivos, nomes ou sites. `docker compose run --rm agentes telemetry` mostra exatamente o que seria enviado. Quem é dono desliga em **Configurações\u00a0›\u00a0Geral**, ou com `TELEMETRY=off` no `.env`.",
          "Relatórios de erro não vão para lugar nenhum, a não ser que você defina `SENTRY_DSN` com um servidor compatível com o Sentry que você escolher. Um relatório tem o erro e onde ele aconteceu, nunca mensagens, e-mails, endereços IP, cookies ou tokens.",
        ],
      },
      {
        id: "reference",
        heading: "O guia completo",
        blocks: [
          "Todas as configurações, um proxy seu como o nginx, rodar sem Docker, um roteiro para agentes de IA que instalam sozinhos e o que fazer quando algo falha estão no `SELF_HOSTING.md`, no repositório do agentes.chat.",
        ],
      },
    ],
  },
};
