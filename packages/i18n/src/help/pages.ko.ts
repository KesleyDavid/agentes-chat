import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

/** The help pages in ko: a page not here shows in English. */
export const helpKo: Partial<Record<HelpSlug, HelpDocument>> = {
  "run-on-your-computer": {
    title: "내 컴퓨터에서 agentes.chat 실행하기",
    summary:
      "agentes.chat 앱은 Mac, PC, Linux 컴퓨터에서 agentes.chat 자체를 실행할 수도 있어요. 혼자 쓰거나 작은 팀에 알맞아요.",
    sections: [
      {
        id: "how",
        heading: "실행 방식",
        blocks: [
          "앱 안에서 실행되고 데이터베이스도 내장되어 있어요. 모든 데이터는 이 컴퓨터의 홈 폴더에 있는 `.agentes` 폴더 하나에 저장돼요. 따로 설치할 건 없어요. Docker도, 데이터베이스 설정도 필요 없어요.",
          "앱을 열면 시작되고 종료하면 멈춰요. 앱을 다시 열 때까지 아무도 agentes.chat을 쓸 수 없어서, 종료하기 전에 먼저 물어봐요.",
        ],
      },
      {
        id: "who",
        heading: "누구에게 맞나요",
        blocks: [
          "혼자 또는 작은 팀이 쓰기 좋아요. 계속 켜 두는 Mac mini, 남는 PC, 노트북이 잘 맞아요. [계속 켜 두기](#keep-on)처럼 설정하세요. Mac이나 PC에서는 이 앱으로 Docker 없이 agentes.chat을 실행할 수 있어요.",
          "더 큰 팀이라면 [어떤 방식을 고를까요](/help/install-on-a-server#choose)를 보세요. 데이터는 나중에 서버로 옮길 수 있어요.",
        ],
      },
      {
        id: "keep-on",
        heading: "계속 켜 두기",
        blocks: [
          "다른 사람도 쓰는 컴퓨터라면 한 번만 이렇게 설정하세요.",
          {
            list: [
              "**로그인할 때 열기**는 설정이 끝나면 저절로 켜져요.",
              "Mac에서는 **시스템 설정\u00a0›\u00a0사용자 및 그룹**에서 **자동 로그인**을 켜세요. 그래야 재시동한 뒤 앱이 열려요. FileVault를 쓰면 자동 로그인이 꺼져요.",
              "Mac에서는 **시스템 설정\u00a0›\u00a0에너지**에서 **정전 후 자동으로 시동**을 켜세요.",
              "서버가 실행 중이고 **휴대폰과 팀원이 접속할 수 있게 하기**가 켜져 있으면 Mac은 잠자기 상태가 되지 않아요. Windows와 Linux에서는 시스템 전원 설정에서 잠자기를 끄세요.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "에이전트도 여기서 일해요",
        blocks: [
          "에이전트도 이 컴퓨터에서 각자의 폴더와 브라우저를 쓰며 일하고, Claude Code나 Codex가 설치되어 있으면 그것도 써요.",
          "여기서 에이전트는 내 권한으로 실행돼요. **명령**은 처음부터 켜져 있고, 켜져 있으면 이 컴퓨터를 쓰는 모든 워크스페이스의 에이전트가 서버 데이터를 포함해 이 컴퓨터의 모든 것에 접근할 수 있어요. **환경설정\u00a0›\u00a0도구**에서 끌 수 있어요. [에이전트가 접근할 수 있는 것](/help/computers#reach)을 보세요.",
        ],
      },
      {
        id: "another-workspace",
        heading: "다른 워크스페이스에도 빌려주기",
        blocks: [
          "여기서 실행하는 서버의 워크스페이스는 따로 할 일 없이 이 컴퓨터를 써요. agentes.chat Cloud 워크스페이스처럼 다른 곳에 있는 워크스페이스도 쓰게 하려면 **환경설정\u00a0›\u00a0서버**를 열고 **서버 추가…**를 누른 다음, 그 워크스페이스에 로그인하고 앱이 물어보면 **허용**을 누르세요.",
          "워크스페이스마다 여기에 자기 에이전트와 폴더가 생겨요. **명령**은 그 워크스페이스에서도 처음부터 켜져 있어요. 앱이 물어볼 때 **허용**을 누르기 전에, 또는 나중에 **환경설정\u00a0›\u00a0도구**에서 끌 수 있어요. 그 스위치 하나가 이 컴퓨터의 모든 워크스페이스에 적용돼요.",
        ],
      },
      {
        id: "reach",
        heading: "휴대폰과 팀원에게서 접속",
        blocks: [
          "**휴대폰과 팀원이 접속할 수 있게 하기**를 켜면 agentes.chat이 내 기기 전용 사설 네트워크인 Tailscale에 연결돼요. 내 휴대폰과 초대한 사람만 참여할 수 있고, 다른 사람은 agentes.chat에 접속할 수 없어요. Tailscale은 무료예요: https://tailscale.com/download. 끄면 agentes.chat은 이 컴퓨터에서만 작동해요.",
          "이 컴퓨터가 이미 Tailscale의 443 포트로 다른 것을 공유하고 있으면 agentes.chat은 8443을 쓰고, 주소가 `:8443`으로 끝나요.",
        ],
      },
      {
        id: "password",
        heading: "다른 기기에서 로그인하기",
        blocks: [
          "소유자는 처음에 비밀번호가 없어요. 이 컴퓨터에서는 앱이 로그인해 줘요. 다른 컴퓨터의 브라우저에서 로그인하려면 **설정\u00a0›\u00a0내 계정**에서 비밀번호를 추가하세요. 휴대폰 앱은 **환경설정\u00a0›\u00a0서버**의 **내 휴대폰에서** 아래에 있는 QR 코드를 스캔해서 연결해요. 이때 **휴대폰과 팀원이 접속할 수 있게 하기**가 켜져 있어야 해요.",
        ],
      },
      {
        id: "updates",
        heading: "업데이트",
        blocks: [
          "앱은 업데이트를 스스로 확인하고, **환경설정\u00a0›\u00a0업데이트**에서 **업데이트하고 다시 열기**를 누르면 설치해요. 서버와 모든 에이전트도 함께 다시 시작돼요. 먼저 데이터베이스를 복사해 두고, 새 버전이 3분 안에 응답하지 않으면 앱이 스스로 이전 버전과 그 데이터로 되돌아가요.",
        ],
      },
      {
        id: "backups",
        heading: "백업",
        blocks: [
          "아직 자동 백업은 없어요. **환경설정\u00a0›\u00a0서버**의 **지금 백업**은 서버를 잠깐 멈추고 데이터베이스, 파일, `.env`를 홈 폴더의 `.agentes/backups`에 저장해요. 가장 최근 것 2개를 남겨요.",
          "가끔 외장 디스크나 클라우드 드라이브처럼 이 컴퓨터 밖으로 복사해 두세요. 키가 들어 있으니 다른 사람에게 보여 주지 마세요.",
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code와 Codex",
        blocks: [
          "앱은 로그인 셸의 `PATH`와 `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` 같은 일반적인 폴더에서 Claude Code와 Codex를 찾아요. **환경설정\u00a0›\u00a0도구**에 **찾지 못함**이 보이면 새 터미널 창에서 `claude`나 `codex`가 실행되는지 확인한 다음, 앱을 종료하고 다시 여세요.",
        ],
      },
      {
        id: "moving",
        heading: "서버로 옮기기",
        blocks: [
          {
            list: ["앱을 종료한 다음, 앱에 들어 있는 서버로 데이터베이스를 덤프하세요. Mac에서는:"],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[서버에 agentes.chat을 설치](/help/install-on-a-server)하되 아직 시작하지 마세요. 그 서버의 `.env`에 `~/.agentes/.env`의 `AGENTES_SECRET`을 넣고, 데이터베이스만 시작하세요: `docker compose up -d postgres`.",
              "덤프를 불러오세요: `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "`docker compose up -d`로 시작하고, 전체 가이드에 나온 대로 `~/.agentes/files`를 복사한 다음, 전처럼 로그인하세요.",
            ],
          },
        ],
      },
    ],
  },
  computers: {
    title: "내 컴퓨터와 휴대폰",
    summary:
      "Mac, PC, Linux 컴퓨터, 서버, 휴대폰을 가져오면 에이전트가 거기서 일해요. agentes.chat Cloud에서도, 내 서버에서도 똑같아요.",
    sections: [
      {
        id: "app",
        heading: "agentes.chat 앱에서",
        blocks: [
          "그 컴퓨터에 앱을 설치해서 열고 워크스페이스에 로그인하세요. **<workspace>의 에이전트가 이 Mac을 사용하게 할까요?**라고 물어봐요(Windows에서는 이 PC, Linux에서는 이 컴퓨터). 누가 쓸 수 있는지 고르고 **허용**을 누르면 끝이에요.",
          "이미 로그인했다면 **환경설정\u00a0›\u00a0일반**의 **에이전트** 카드에서 워크스페이스를 켜세요.",
        ],
      },
      {
        id: "web",
        heading: "웹사이트에서",
        blocks: [
          "**설정\u00a0›\u00a0기기**에서 **기기 연결**을 누르세요.",
          {
            list: [
              "**이 Mac** 또는 **이 PC**: 앱이 열리고, 앱이 먼저 물어봐요.",
              "**다른 컴퓨터**: 그 컴퓨터에 앱을 설치하고 내 계정으로 로그인한 다음 **허용**을 누르세요. 여기에 저절로 나타나요.",
              "**서버 또는 VPS**: 그 서버의 터미널에서 한 줄을 실행하고 참여를 허락하세요. 이 줄은 10분 안에 한 번만 쓸 수 있어요.",
            ],
          },
          "앱이 클릭 한 번으로 연결하는 건 `.ts.net`으로 끝나는 Tailscale 주소처럼 https 주소뿐이에요. 일반 http 주소에서는 터미널 한 줄을 쓰세요.",
        ],
      },
      {
        id: "phones",
        heading: "휴대폰",
        blocks: [
          "Android 휴대폰은 이미 연결된 컴퓨터를 통해 연결돼요. 케이블로 연결하거나, 2026년 5월 보안 업데이트가 적용된 Android 14 이상이라면 Wi-Fi로도 돼요. iPhone은 앱과 Xcode가 설치된 Mac을 통해 연결되고, 나머지는 앱이 준비해요. 둘 다 **기기 연결**에서 시작해요.",
        ],
      },
      {
        id: "who",
        heading: "누가 쓸 수 있나요",
        blocks: [
          "새 기기는 나만 쓸 수 있어요. **나만**은 나와 나를 위해 일하는 에이전트를 뜻해요. 허용할 때나 나중에 **설정\u00a0›\u00a0기기**의 그 기기 페이지에서 워크스페이스 전체나 일부 사람과 역할에게 열 수 있어요.",
        ],
      },
      {
        id: "open",
        heading: "앱이 열려 있는 동안",
        blocks: [
          "에이전트는 그 컴퓨터에서 앱이 실행 중이고 컴퓨터가 깨어 있을 때만 일해요. 앱이 물어볼 때 **준비해 두기: 로그인할 때 agentes.chat 열기**를 체크한 채로 두세요. 꺼져 있거나 잠자기 중인 컴퓨터는 **오프라인**으로 보이고, 에이전트는 돌아올 때까지 기다려요.",
        ],
      },
      {
        id: "pausing",
        heading: "일시 중지와 연결 해제",
        blocks: [
          "컴퓨터에서는 시계 옆의 agentes.chat 아이콘으로 모든 워크스페이스의 에이전트를 일시 중지해요. **환경설정\u00a0›\u00a0일반**에서는 워크스페이스마다 있는 스위치로 그 워크스페이스만 일시 중지하고, **나가기**로 연결을 해제해요. 일시 중지 중에는 새 작업이 시작되지 않고, 실행 중이던 작업은 끝까지 마쳐요. 연결을 해제해도 에이전트 폴더는 디스크에 남아요.",
          "웹사이트에서는 기기 페이지의 **삭제**로 연결을 해제해요.",
        ],
      },
      {
        id: "organizations",
        heading: "컴퓨터 한 대, 여러 워크스페이스",
        blocks: [
          "같은 앱에서 워크스페이스마다 로그인하고 각각 **허용**을 누르세요. agentes.chat Cloud의 워크스페이스와 내 서버의 워크스페이스가 컴퓨터 한 대를 함께 쓸 수 있어요(앱 0.6.1 이상). 워크스페이스마다 거기에 자기 에이전트와 폴더가 있고, 하나를 연결 해제해도 나머지는 그대로예요.",
          "앱이 이 컴퓨터에서 실행하는 서버는 이미 연결되어 있어서 따로 할 일이 없어요. 그 컴퓨터를 다른 곳에 있는 워크스페이스에도 빌려주려면 [다른 워크스페이스에도 빌려주기](/help/run-on-your-computer#another-workspace)를 보세요.",
          "노트북의 앱을 워크스페이스를 보는 창으로만 쓰나요? 에이전트가 노트북을 쓰게 할지 물어보면 **나중에**를 누르세요. 그냥 창으로 남아요.",
        ],
      },
      {
        id: "folders",
        heading: "폴더",
        blocks: [
          "에이전트마다 항상 `~/agentes/<workspace>`에 자기 폴더가 있어요. 다른 폴더는 웹사이트가 아니라 컴퓨터에서 직접만 허용할 수 있어요. 앱에서는 **환경설정 › 폴더**, 서버에서는 `agentes-runner folders allow`로 허용하세요. 폴더 허용은 워크스페이스마다 따로예요. 한 워크스페이스에서 허용한 폴더는 그 워크스페이스의 에이전트에게만 적용돼요. 폴더를 제거해도 아무것도 삭제되지 않고 접근 권한만 없어져요.",
        ],
      },
      {
        id: "reach",
        heading: "에이전트가 접근할 수 있는 것",
        blocks: [
          "에이전트는 그 컴퓨터의 사용자인 내 권한으로 실행돼요. 파일 도구는 자기 폴더 안에서만 쓰지만, 명령은 내가 읽을 수 있는 건 무엇이든 읽을 수 있어요.",
          {
            list: [
              "내 파일과 로그인 정보",
              "다른 워크스페이스의 것을 포함한 다른 에이전트의 폴더와, 그 브라우저에 남아 있는 로그인",
              "이 컴퓨터를 연결하는 토큰",
              "agentes.chat도 실행하는 컴퓨터라면 `.agentes`에 있는 그 데이터베이스와 키",
            ],
          },
          "agentes.chat은 키, 토큰, 로그인 정보를 가리키는 명령을 거부하지만, 그건 규칙일 뿐 벽은 아니에요. **명령**은 처음부터 켜져 있어요. 앱이 물어볼 때 **허용**을 누르기 전에, 또는 나중에 **환경설정\u00a0›\u00a0도구**에서 끌 수 있어요. 그 스위치 하나가 그 컴퓨터의 모든 워크스페이스에 적용돼요. Claude Code와 Codex는 에이전트 폴더에서 자기 규칙에 따라 자기 명령을 실행해요.",
          "진짜 벽이 필요하면 Linux 서버를 쓰세요. Debian 13에 `--system`으로 설치하면 에이전트마다 자기 사용자가 생겨요. Ubuntu에서는 에이전트가 `agentes`라는 사용자 하나를 함께 써요. 서로의 폴더는 보이지만 내 것이나 서버의 것은 보이지 않아요. 아니면 에이전트에게 전용 컴퓨터를 주세요.",
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "워크스페이스 컴퓨터",
    summary: "워크스페이스마다 항상 켜져 있는 전용 컴퓨터가 있고, 에이전트는 거기서 일해요.",
    sections: [
      {
        id: "what",
        heading: "어떤 컴퓨터인가요",
        blocks: [
          "이 워크스페이스만을 위한, 항상 켜져 있는 컴퓨터예요. 에이전트마다 전용 사용자가 있고, 각자의 폴더, 화면, 브라우저, 파일이 있어요. 에이전트 페이지에서 일하는 모습을 지켜보고, 필요하면 직접 조작할 수 있어요.",
        ],
      },
      {
        id: "own",
        heading: "내 컴퓨터와 휴대폰",
        blocks: [
          "에이전트는 내가 가져온 컴퓨터와 휴대폰에서도 일할 수 있어요. agentes.chat 앱이 설치된 Mac이나 PC, 서버, Android 휴대폰, iPhone이요. [내가 가져온 컴퓨터와 휴대폰](/help/computers)을 보세요.",
        ],
      },
      {
        id: "plans",
        heading: "내 AI 요금제",
        blocks: [
          "에이전트는 이 컴퓨터에 로그인한 내 AI 요금제(Claude, ChatGPT, GLM, Kimi 등)로 생각할 수 있어요. API 키는 필요 없어요. 계정은 이 컴퓨터에만 남고, agentes.chat은 비밀번호나 접근 권한을 절대 보지 않아요.",
          "Google의 AI Pro와 Ultra 요금제는 여기서 쓸 수 없어요. Google 약관상 다른 제품에서 쓸 수 없기 때문이에요. Gemini API 키는 쓸 수 있어요.",
        ],
      },
      {
        id: "size",
        heading: "사양",
        blocks: ["CPU, 메모리, 디스크는 **설정 › 기기**에서 볼 수 있어요."],
      },
      {
        id: "trouble",
        heading: "응답이 없을 때",
        blocks: ["보통 몇 분 안에 돌아오고, 저희가 이미 살펴보고 있어요. 따로 하실 일은 없어요."],
      },
    ],
  },
  import: {
    title: "에이전트 가져오기",
    summary: "다른 앱이나 다른 agentes.chat 워크스페이스에서 에이전트를 지침, 스킬, 루틴, 메모리와 함께 가져오세요.",
    sections: [
      {
        id: "comes",
        heading: "함께 오는 것",
        blocks: [
          {
            list: [
              "에이전트: 이름, 역할, 지침, 모습까지.",
              "스킬: 원래 쓰던 에이전트에게 켜진 상태로.",
              "공개 채널: 채널에 있던 에이전트와 함께.",
              "루틴: 활성 상태로, 원래 일정대로. 원하면 **루틴**에서 일시 중지하세요.",
              "메모리: 각 에이전트가 기억하는 내용.",
              "에이전트별 파일(OpenBot.run의 files 폴더, OpenClaw 워크스페이스)은 **Drive**에 에이전트 이름의 폴더로 들어가요. 키, 로그인 정보, 시스템 파일은 가져오지 않고, 이미 있는 파일은 바꾸지 않아요.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "절대 오지 않는 것",
        blocks: [
          "키, 비밀번호, 로그인 정보, 채팅 기록은 절대 가져오지 않아요. 에이전트는 워크스페이스의 AI로 생각해요. 아직 여기에 대응하는 기능이 없거나 파일로 옮기면 안 되는 것도 있어요. 나중에 다시 만들 수 있어요.",
          "파일과 폴더는 브라우저에서 읽어요. GitHub 링크는 워크스페이스 서버를 거쳐요. 키와 로그인 파일은 절대 열지 않고, 확인하기 전에는 아무것도 바뀌지 않아요.",
        ],
      },
      {
        id: "other-apps",
        heading: "다른 앱에서",
        blocks: [
          "**Grok Bot**, **ChatGPT dots**, **다른 앱** 중에서 고르세요. 요청문을 복사해 그 앱에 붙여넣고, 돌려받은 내용을 가져오세요. 파일을 끌어다 놓거나 답변 전체를 붙여넣으면 돼요. 앱별로 넣는 곳:",
          {
            list: [
              "**Grok Bot**: 내 봇과의 채팅에. JSON으로 답하니 답변 전체를 복사하세요.",
              "**ChatGPT dots**: 새 채팅에. 만들어 준 파일을 내려받으세요.",
              "**Claude**: 새 대화나 에이전트 프로젝트에. 만들어 준 파일을 내려받으세요.",
              "**Manus**: 새 작업에. 파일은 작업 결과에 있어요.",
              "**Rakazo**: 내 에이전트에게 보내세요. JSON으로 답하니 답변 전체를 복사하세요.",
              "**OpenBot**: 요청문이 필요 없어요. 테넌트 폴더(agents.yaml, agents/, model.yaml, skills.yaml)를 끌어다 놓거나 GitHub 링크를 붙여넣으세요.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "워크스페이스 내보내기",
        blocks: [
          "**설정 › 가져오기와 내보내기 › 내보내기**를 누르면 .json 파일을 내려받아요. 에이전트를 다른 워크스페이스로 옮기거나 사본을 보관할 때 쓰세요. 파일에 담기는 것:",
          {
            list: [
              "에이전트: 지침, 모델, 모습까지",
              "스킬: SKILL.md 전체까지",
              "공개 채널: 채널의 에이전트까지",
              "예약된 루틴(가져간 곳에서 활성 상태로 시작해요)",
              "워크스페이스의 모두가 볼 수 있는 메모리",
            ],
          },
          "절대 담기지 않는 것:",
          {
            list: [
              "API 키와 비밀번호",
              "커넥터와 로그인 정보",
              "컴퓨터",
              "대화, 메시지, 비공개 채널",
              "사용량, 비용, 활동 기록",
            ],
          },
          "파일을 쓰려면 다른 워크스페이스에서 **설정 › 가져오기와 내보내기**를 열고 .json 파일을 끌어다 놓으세요.",
        ],
      },
    ],
  },
  wiki: {
    title: "Wiki",
    summary: "회사가 아는 것을 서로 연결된 페이지로 모아 둬요.",
    sections: [
      {
        id: "links",
        heading: "링크",
        blocks: [
          "[[를 입력하면 다른 페이지로 링크할 수 있어요. 백링크와 그래프에서 페이지가 어떻게 연결되는지 보여요.",
        ],
      },
      {
        id: "agents",
        heading: "에이전트가 쓰는 방법",
        blocks: ["에이전트는 답할 때 Wiki를 읽어요. Wiki에 글을 쓰는 건 누군가 요청할 때뿐이에요."],
      },
      {
        id: "obsidian",
        heading: "Obsidian 보관함 가져오기",
        blocks: [
          "보관함 폴더나 그 .zip 파일을 설정의 컨텍스트 단계나 Wiki 자체의 가져오기에 끌어다 놓으세요. [[링크]], [[note|alias]], [[note#section]]은 그대로 작동해요. 태그는 frontmatter와 본문에서 가져와요. 첨부 파일은 Drive로 가고, 삽입된 이미지와 파일은 페이지의 카드가 돼요. 콜아웃은 콜아웃으로 남아요. Dataview 쿼리는 텍스트로 들어오니 표는 에이전트에게 만들어 달라고 하세요. 캔버스와 Obsidian 설정(.obsidian)은 가져오지 않아요.",
        ],
      },
    ],
  },
  memory: {
    title: "메모리",
    summary: "각 에이전트가 대화와 팀의 수정에서 배우는 것.",
    sections: [
      {
        id: "learns",
        heading: "에이전트가 배우는 방법",
        blocks: [
          "에이전트는 대화와 팀의 수정에서 배워요. 에이전트가 아는 내용은 관련 있을 때 컨텍스트에 들어가요. **메모리** 탭에서 틀리거나 오래된 내용을 수정하거나 고정하거나 보관하세요.",
        ],
      },
      {
        id: "permissions",
        heading: "메모리는 권한을 주지 않아요",
        blocks: [
          "메모리에 무엇이 있든 에이전트가 더 많은 일을 할 수 있게 되지는 않아요. 할 수 있는 일은 **도구 및 접근 권한**에서 정해지고, 민감한 작업은 항상 승인을 요청해요.",
        ],
      },
      {
        id: "proposals",
        heading: "변경 제안",
        blocks: [
          "같은 교훈이 반복되면 에이전트가 자기 지침이나 워크스페이스 컨텍스트를 바꾸자고 제안할 수 있어요. 누군가 수락하기 전에는 아무것도 바뀌지 않고, 수락 전에 문구를 고칠 수도 있어요. 이전 버전은 기록에 남아요. 거절된 제안은 교훈으로 남아서 다시 제안되지 않아요.",
        ],
      },
    ],
  },
  approvals: {
    title: "승인",
    summary: "민감한 작업은 사람을 기다려요. 한 번만, 또는 계속.",
    sections: [
      {
        id: "what",
        heading: "먼저 물어보는 일",
        blocks: [
          "에이전트가 병합, 배포, 롤백, 외부로 무언가 보내기, 데이터 삭제를 하려고 하면 어떤 접근 권한이 있든 먼저 물어봐요. 요청은 **승인**과 대화에 정확한 작업 내용과 이유와 함께 표시돼요.",
        ],
      },
      {
        id: "always",
        heading: "한 번, 또는 항상",
        blocks: [
          "승인은 값까지 정해진 정확한 작업 하나에만 적용돼요. 에이전트가 무엇이든 바꾸면 다시 물어봐요.",
          "**항상 승인**을 누르면 에이전트가 이제부터 그런 종류의 작업을 어떤 값으로든 묻지 않고 해요. 루틴의 요청에서는 **이 루틴에서 항상 승인**이 그 루틴에서만 같은 일을 해요. 둘 다 병합, 배포, 롤백 같은 작업에는 나오지 않아요. 되돌리려면 에이전트 페이지의 **도구 및 접근 권한**이나 루틴 설정으로 가세요.",
        ],
      },
      {
        id: "who",
        heading: "누가 승인하나요",
        blocks: [
          {
            list: [
              "에이전트의 소유자가 그 에이전트의 요청을 승인해요.",
              "역할에 **에이전트 작업 승인**이 있는 사람은 모든 에이전트의 요청을 승인해요.",
              "에이전트가 요청할 때 지목한 사람은 소유자 대신 승인해요.",
              "**나 대신 승인할 사람**에서 누군가를 대신하는 사람은 그 사람에게 온 요청을 승인해요. 병합, 배포 같은 위험한 작업은 그 설정이 켜져 있을 때만요.",
            ],
          },
          "누군가의 메일함에서 하는 작업은 그 사람만 기다려요. 에이전트의 새 접근 권한은 에이전트를 관리하는 사람을 기다려요.",
          "당신의 오른팔 Lodi도 다른 에이전트가 제안한 새 에이전트와 에이전트의 모델, 예산, 채널 변경을 당신이 요청했을 때만 대신 승인할 수 있어요. 누가 당신을 대신할지, Lodi가 무엇을 승인할지는 **설정\u00a0›\u00a0나\u00a0›\u00a0승인**에서 골라요.",
        ],
      },
      {
        id: "refusing",
        heading: "거절하기",
        blocks: ["원하면 이유를 적어 주세요. 에이전트가 읽고 계획을 고친 뒤 교훈으로 기억해요."],
      },
      {
        id: "meetings",
        heading: "회의",
        blocks: ["에이전트는 시간을 제안만 해요. 사람에게 보내는 초대는 항상 요청한 사람을 거쳐요."],
      },
    ],
  },
  "who-answers": {
    title: "누가 메시지에 답하나요",
    summary: "멘션하면 그 에이전트가 답해요. 멘션이 없으면 agentes.chat이 아래 순서대로 골라 줘요.",
    sections: [
      {
        id: "order",
        heading: "메시지가 에이전트를 찾는 방법",
        blocks: [
          "에이전트를 @멘션한 메시지는 그 에이전트에게 가요. 아무도 멘션하지 않은 메시지는 워크스페이스에 있는 다음 중 첫 번째가 읽어요.",
          {
            list: [
              "**Jev**: 이런 결정을 위해 만든 작고 빠른 모델.",
              "**워크스페이스 API 키 중 하나로 쓰는 작은 모델**: Claude Haiku 5.5나 GPT-6 Luna 같은 모델.",
              "**내 Claude 또는 ChatGPT 요금제**: 직접 운영하는 서버에서 내가 쓴 메시지에만. 요금제가 로그인된 컴퓨터에서 읽고, 몇 초 걸려요.",
              "**간단한 규칙**: 에이전트에게 단 답글은 그 에이전트에게 가요. 방금 대화한 에이전트에게 바로 이어서 보낸 메시지, 나와 에이전트 하나만 있는 채널의 메시지도 마찬가지예요.",
            ],
          },
          "어느 것도 맞지 않으면 아무 에이전트도 답하지 않아요. 에이전트를 부르려면 멘션하세요.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "agentes.chat이 워크스페이스를 호스팅하면 Jev가 포함돼요. 직접 운영하는 서버에서는 소유자의 TypeSafe 키를 쓰고, 메시지당 약 US$ 0.0001이 들어요: [Jev 설정하기](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "내 요금제가 내 메시지만 고르는 이유",
        blocks: ["Claude와 ChatGPT 요금제는 개인용이라서, 내 요금제는 내가 쓴 메시지에 대해서만 골라요."],
      },
      {
        id: "see",
        heading: "누가 골랐는지 보기",
        blocks: ["메시지 아래의 체크 표시를 열어 보세요. 마지막 줄에 누가 에이전트를 골랐는지 나와요."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "TypeSafe가 만든 빠른 모델로, 에이전트를 위해 빠른 결정을 내려요. 내 서버에서는 선택 사항이고, 내 키로 써요.",
    sections: [
      {
        id: "what",
        heading: "하는 일",
        blocks: [
          {
            list: [
              "**답할 에이전트를 골라요.** 아무도 @멘션하지 않은 메시지를 1초 안에 알맞은 에이전트에게 보내요. 에이전트가 요금제로 생각하고 API 키가 없어도 돼요.",
              "**메모리를 정리해요.** 다른 말로 쓰여 있어도 중복이나 더 새로운 사실을 알아봐요. 중복은 에이전트가 알던 내용과 합치고, 새로운 사실은 옛 사실을 대신해요. 하루에 한 번 나머지도 정리해요.",
              "**화면을 봐요.** 에이전트가 브라우저와 데스크톱에서 설명만으로 버튼과 입력란을 찾고, 작은 건 더 가까이 보고, 화면 이미지로 단계가 잘 됐는지 확인해요.",
              "**덜 읽게 해요.** 턴마다 에이전트에게 필요할 것 같은 도구만 불러와서, AI가 덜 읽고 비용도 줄어요.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Jev가 없으면",
        blocks: [
          "모든 게 계속 작동하지만, 더 느리고 덜 꼼꼼해요.",
          {
            list: [
              "**답할 에이전트:** API 키 중 하나로 Claude Haiku 5.5나 GPT-6 Luna 같은 작은 모델이 골라요. 키가 없으면 각자의 Claude 또는 ChatGPT 요금제가 그 사람이 쓴 메시지에 대해 몇 초 안에 골라요. 그것도 없으면 답글이나 이어서 보낸 메시지는 여전히 해당 에이전트에게 가요. 에이전트를 부르려면 멘션하세요. [에이전트를 고르는 방법](/help/who-answers)",
              "**메모리:** 같은 말로 된 중복은 여전히 합쳐져요. 다른 말로 된 중복과 업데이트는 따로 남아요.",
              "**화면:** 에이전트는 화면에 표시된 번호와 정확한 이름을 써요. 이미지에서는 아무것도 읽지 않아요.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "설정하기",
        blocks: [
          {
            list: [
              "TypeSafe 콘솔(https://console.typesafe.ai)을 열고 Google이나 이메일로 로그인하세요. 새 계정도 같은 방법으로 만들어져요.",
              "콘솔에서 크레딧을 충전하세요. Jev는 선불이에요.",
              "키 페이지(https://console.typesafe.ai/keys)를 열어 키를 만들고 바로 복사하세요.",
              "agentes.chat에서 **설정 › AI와 사용량**을 열고 **Jev** 아래에 붙여넣으세요. 이 서버를 설정한 사람만 볼 수 있어요.",
            ],
          },
          "Docker로 운영하는 서버라면 대신 `.env`에 `TYPESAFE_API_KEY`로 키를 넣어도 돼요. 그 키가 설정의 키보다 우선해요.",
        ],
      },
      {
        id: "cost",
        heading: "비용",
        blocks: [
          {
            list: [
              "Jev가 읽는 토큰 100만 개당 US$ 0.042예요. 답변은 무료예요. 답할 에이전트를 고를 때 약 2,500토큰을 읽으니 약 US$ 0.0001이에요. 스크린샷 한 장은 약 3,900토큰이에요.",
              "구매한 크레딧은 12개월 동안 유효해요. Jev 크레딧이 떨어지지 않도록 콘솔에서 자동 충전을 켜 두세요.",
              "**설정 › AI와 사용량**에서 이번 달 Jev가 내린 결정 수와 비용을 볼 수 있어요.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "내 데이터",
        blocks: [
          "Jev가 결정하려고 읽는 것:",
          {
            list: [
              "채널 이름과 설명, 메시지와 그 직전 몇 개",
              "에이전트의 이름과 역할, 지침의 앞부분, 쓸 수 있는 도구",
              "비교하는 메모리 항목",
              "에이전트의 작업과 도구 결과의 앞부분",
              "미션의 목표와 에이전트가 그 미션을 위해 실행하려는 명령",
              "연결된 앱이 제공하는 도구",
              "에이전트가 쓰고 있는 페이지나 화면(스크린샷 포함)",
            ],
          },
          "TypeSafe는 Jev를 미국에서 운영하고, 보낸 내용으로 모델을 학습시키지 않아요. 데이터는 서비스 운영에 필요한 기간만 보관해요. 엔터프라이즈 요금제에서는 데이터를 전혀 보관하지 않는 옵션도 있어요.",
          "TypeSafe 개인정보처리방침: https://typesafe.ai/legal/privacy-policy. 데이터 처리 계약: https://typesafe.ai/legal/data-processing.",
        ],
      },
      {
        id: "problems",
        heading: "멈췄을 때",
        blocks: [
          {
            list: [
              "**키가 거부됨:** 새 키를 만들어 **설정 › AI와 사용량**에 붙여넣으세요.",
              "**크레딧 부족:** 콘솔에서 크레딧을 충전하세요. Jev는 30분 안에 다시 시도하고, **다시 확인**을 클릭해도 돼요.",
              "**사용량이 많거나 연결 불가:** TypeSafe가 초당 요청 수를 제한하거나 잠시 응답하지 않을 수 있어요. Jev는 스스로 다시 작동해요. 내 한도: https://console.typesafe.ai/rate-limits. 더 높은 한도가 필요하면 sales@typesafe.ai로 문의하세요.",
            ],
          },
          "그동안 에이전트는 [Jev가 없으면](/help/jev#without)처럼 일해요.",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "AI 앱",
    summary:
      "Claude, Cursor 등 MCP 앱을 떠나지 않고 agentes.chat의 에이전트에게 작업을 맡기고, 그 자리에서 답을 받으세요.",
    sections: [
      {
        id: "what",
        heading: "작동 방식",
        blocks: [
          "agentes.chat은 MCP 서버예요. AI 앱에 주소를 붙여넣고, 내 계정으로 로그인하고, 워크스페이스를 고르세요. 그러면 앱이 에이전트와 채널 목록을 보고, 나 대신 에이전트에게 작업을 보내고, 답을 기다리고, 최근 작업을 읽을 수 있어요.",
          '예를 들어 Unity나 Blender에서 장면 작업을 하다가 Claude에게 "마케팅 에이전트에게 출시 소개 문구를 부탁해 줘"라고 하세요. 메시지는 agentes.chat에 내 메시지로 **Claude 경유** 표시와 함께 나타나고, 에이전트의 답은 Claude로 돌아와요.',
          "주소는 **설정 › AI 앱**에 있어요. `/mcp`로 끝나요.",
        ],
      },
      {
        id: "connect",
        heading: "앱 연결하기",
        blocks: [
          {
            list: [
              "**Claude**(claude.ai, Claude Desktop, 휴대폰): **맞춤 설정 › 커넥터**(Customize › Connectors)에서 **+ 추가**를 클릭하고 **사용자 지정 커넥터 추가**(Add custom connector)를 클릭하세요. 이름을 agentes.chat으로 정하고 주소를 붙여넣은 뒤 **계속**을 클릭하세요. **지금 로그인**(Sign in now)을 고르고 **추가**를 클릭한 다음 권한을 허용하세요. Team과 Enterprise 요금제에서는 Claude 조직의 소유자가 조직 설정 › 커넥터에서 커넥터를 추가하고, 각자 맞춤 설정 › 커넥터에서 **연결**을 클릭해요. Claude 무료 요금제에서는 사용자 지정 커넥터를 하나 추가할 수 있어요.",
              "**Claude Code:** `claude mcp add --transport http --scope user agentes <주소>`를 실행한 다음 `/mcp`를 입력하고 agentes를 골라 **Authenticate**를 선택하세요. 현재 폴더에서만 쓰려면 `--scope user`를 빼세요.",
              "**Cursor:** **설정 › AI 앱**에서 **Cursor에 추가**를 누르거나, `~/.cursor/mcp.json`에 주소를 넣으세요. 처음 쓸 때 Cursor가 로그인을 요청해요.",
              '**VS Code:** **VS Code에 추가**를 누르거나, `.vscode/mcp.json`에 `"type": "http"`와 함께 주소를 넣으세요.',
              "**다른 앱:** ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains 등은 **앱 연결**에 각자의 단계가 있고, 주소도 미리 채워져 있어요.",
            ],
          },
          "로그인할 때 agentes.chat이 어떤 앱이 접근을 요청했고 어디로 돌아가는지 보여 줘요. 방금 직접 연결을 시작한 경우에만 계속하세요.",
        ],
      },
      {
        id: "tools",
        heading: "앱이 할 수 있는 일",
        blocks: [
          {
            list: [
              "`send_to_agent`: 에이전트와의 비공개 대화나 채널에서 나 대신 에이전트에게 메시지를 보내고 답을 기다려요. **에이전트 작업 읽기 및 보내기** 권한이 있을 때만 쓸 수 있어요.",
              "`wait_for_reply`: 작업의 답을 계속 기다려요.",
              "`list_agents`: 내가 볼 수 있는 에이전트.",
              "`list_channels`: 내가 읽을 수 있는 채널.",
              "`read_conversation`: 채널, 스레드, 작업의 최근 메시지.",
              "`list_recent_tasks`: 앱에서 보낸 작업과 에이전트가 지금 하고 있는 일.",
            ],
          },
          "앱은 나로서 행동하고 내가 볼 수 있는 것만 봐요. 에이전트의 작업을 승인하지는 않아요. 에이전트가 승인을 요청하며 멈추면 답에 링크와 함께 그 사실이 나오고, 결정은 agentes.chat에서 사람이 해요. 설정, 멤버, 권한도 바꾸지 않아요.",
        ],
      },
      {
        id: "workspace",
        heading: "연결 하나에 워크스페이스 하나",
        blocks: [
          "연결마다 로그인할 때 고른 워크스페이스 하나에만 적용돼요. 다른 워크스페이스를 쓰려면 앱을 다시 연결하고 그 워크스페이스를 고르세요.",
          "**설정 › AI 앱**에서 연결된 앱과 각 앱을 마지막으로 쓴 시점을 보고, 어느 앱이든 연결을 끊을 수 있어요. 멤버를 관리하는 사람은 워크스페이스 전체의 앱을 보고 연결을 끊을 수도 있어요. 앱에서 보낸 메시지는 모두 감사 로그에 남아요.",
        ],
      },
      {
        id: "tokens",
        heading: "개인 토큰",
        blocks: [
          "OAuth 로그인을 지원하지 않는 스크립트와 앱에서는 **설정 › AI 앱**에서 개인 토큰을 만들어 `Authorization: Bearer` 헤더로 보내세요. 토큰은 한 번만 표시되고, 만든 워크스페이스에서만 작동하며, 30일, 90일, 1년 후에 만료되거나 만료되지 않게 할 수 있어요.",
          "https가 없는 서버를 다른 컴퓨터에서 쓸 때는 개인 토큰을 쓰세요. OAuth 로그인에는 https가 필요해요.",
        ],
      },
      {
        id: "limits",
        heading: "한도",
        blocks: [
          {
            list: [
              "연결당 1분에 최대 120건, 하루 최대 5,000건의 요청.",
              "워크스페이스마다 한 사람당 1분에 최대 20개, 하루 최대 500개의 메시지.",
              "한 번 기다리는 시간은 최대 45초예요. 에이전트가 아직 일하고 있으면 앱이 다시 기다려요.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "다른 사람이 쓴 글",
        blocks: [
          "답에는 agentes.chat의 에이전트와 사람이 쓴 글이 담겨요. 앱은 그 글을 지시가 아닌 콘텐츠로 표시해서 받지만, 글이 앱에게 다른 일을 하도록 유도할 수도 있어요. 확인하기 전에 앱이 하려는 일을 살펴보세요.",
        ],
      },
      {
        id: "problems",
        heading: "연결되지 않을 때",
        blocks: [
          {
            list: [
              "**요청이 만료됨:** 로그인 페이지는 30분 동안 한 번만 쓸 수 있어요. 앱으로 돌아가 다시 연결하세요.",
              "**앱이 다시 로그인을 요청함:** 연결이 끊겼거나, 비밀번호가 바뀌었거나, 워크스페이스를 나갔어요. 앱에서 다시 로그인하세요.",
              "**Cursor가 예전 로그인에 멈춤:** Cursor를 종료하고 `~/.mcp-auth` 폴더를 삭제한 다음 다시 연결하세요.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "서버에 agentes.chat 설치하기",
    summary: "내 서버에서 agentes.chat을 무료로 실행하고 팀 전체가 함께 쓰세요. 명령 하나로 준비됩니다.",
    sections: [
      {
        id: "choose",
        heading: "어떤 방식을 고를까요",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**: 어떤 팀에도 맞고 어디서나 접속할 수 있습니다. 운영, 업데이트, 백업은 저희가 합니다. 워크스페이스마다 전용 컴퓨터가 있고, 거기서 에이전트마다 자기 사용자가 있습니다.",
              "**내 컴퓨터와 앱**: 혼자 또는 작은 팀에 맞고, 그 컴퓨터가 켜져 있는 동안 접속할 수 있습니다. 계속 켜 두는 Mac mini가 잘 맞습니다. 업데이트는 클릭 한 번으로 하고, 백업은 직접 합니다. 에이전트는 그 컴퓨터에서 내 권한으로 실행됩니다.",
              "**서버**: 더 큰 팀에 맞고, 항상 켜져 있습니다. 업데이트는 명령 3개로 하고, 매일 자동으로 백업할 수도 있습니다. Debian 13에서는 에이전트마다 자기 사용자가 있습니다.",
            ],
          },
          "내 컴퓨터에서 서버로: [서버로 옮기기](/help/run-on-your-computer#moving). 어느 방식이든 [에이전트 가져오기](/help/import)로 다른 방식의 에이전트를 가져올 수 있습니다.",
        ],
      },
      {
        id: "need",
        heading: "필요한 것",
        blocks: [
          {
            list: [
              "64비트 Linux(x64 또는 arm64) 서버나 VPS. 작은 팀이라면 CPU 2개, 메모리 4 GB, 디스크 20 GB로 시작하면 좋습니다. Mac이나 PC에서는 [앱으로 agentes.chat을 실행](/help/run-on-your-computer)할 수 있고, Docker가 필요 없습니다.",
              "Compose가 포함된 Docker. Linux에서는 없으면 설치 프로그램이 먼저 물어본 뒤 설치합니다.",
              "접속 방법. 무료 Tailscale 계정(기본값, 비공개, 도메인과 열린 포트 불필요)이나, 서버를 가리키는 도메인과 열린 80, 443 포트 중 하나가 필요합니다.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "설치하기",
        blocks: [
          "서버에서 다음을 실행하세요.",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "없는 것을 설치한 뒤 몇 가지를 묻습니다. 사람들이 접속하는 방법, 이메일, 이 서버를 에이전트의 컴퓨터로도 쓸지, 익명 사용 통계를 보낼지입니다. Enter를 누르면 제안된 답을 고릅니다. 설치 위치는 `/opt/agentes`(이미 Docker를 쓸 수 있는 사용자라면 `~/agentes`)이고, 처음에는 약 2 GB를 내려받습니다.",
          "마지막에 서버 주소와 휴대폰용 QR 코드를 보여 줍니다. 다시 실행해도 괜찮습니다. 설정은 그대로 두고 빠진 것만 채웁니다.",
          "Node.js 18 이상이 있다면 빈 폴더에서 `npx @agenteschat/setup`을 실행해도 같은 설정입니다. Node가 없으면 앱 이미지에서 현재 폴더를 대상으로 실행할 수 있고, 마지막에 나머지를 시작하는 명령을 보여 줍니다.",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "접속 방법",
        blocks: [
          {
            list: [
              "**Tailscale**(기본값): `https://agentes.<내-tailnet>.ts.net`의 비공개 HTTPS로, Tailscale 네트워크에 있는 기기만 열 수 있습니다. 설치 전에 https://console.tailscale.com/admin/dns 에서 MagicDNS와 HTTPS를 켜고, 설정에서 물어볼 인증 키(auth key)를 https://console.tailscale.com/admin/settings/keys 에서 만들어 두세요.",
              "**공개 도메인**: 인터넷의 누구나 열 수 있습니다(예: `https://chat.example.com`). 도메인이 서버를 가리키게 하고 80, 443 포트를 여세요. 설정이 인증서를 받고 갱신하며, 도메인을 공개하기 전에 계정을 만들도록 안내합니다.",
              "**이 기기만**: `http://localhost:3000`. 내 컴퓨터에서 시험해 보는 용도입니다.",
            ],
          },
          "Tailscale에서는 키가 만료되면(180일 후) 서버가 네트워크에서 빠집니다. 계속 두려면 https://console.tailscale.com/admin/machines 에서 서버의 **⋯** 메뉴를 열고 **Disable Key Expiry**를 고르세요.",
          "루틴을 시작하는 웹훅과 자기 서버에서 호출하는 AI 앱에는 공개 주소가 필요합니다. Tailscale에서는 Funnel이 같은 주소를 인터넷에 엽니다. https://console.tailscale.com/admin/acls 에서 tailnet 정책에 Funnel을 추가하고 `.env`에 `TAILSCALE_FUNNEL=true`를 넣은 뒤 `docker compose up -d`를 실행하세요.",
        ],
      },
      {
        id: "owner",
        heading: "내 계정",
        blocks: [
          "서버 주소를 열고 가입하세요. 첫 계정이 소유자가 됩니다. 그 뒤로는 가입이 닫히고, 다른 사람은 **설정\u00a0›\u00a0멤버와 초대**에서 보낸 초대로 들어옵니다.",
          "Tailscale에서는 초대하는 사람도 내 tailnet에 있어야 합니다. 먼저 https://console.tailscale.com/admin/users 에서 초대한 다음 agentes.chat에서 초대하세요.",
        ],
      },
      {
        id: "email",
        heading: "이메일",
        blocks: [
          "이메일이 없으면 agentes.chat은 이메일을 보내는 대신 로그에 기록하므로, 초대 링크는 거기서 복사할 수 있습니다. 비밀번호 재설정은 꺼져 있습니다.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "설정에서는 내 메일 서버(SMTP)나 MillionSend, Resend 같은 Resend 호환 API의 키를 쓸 수 있습니다. 다른 보낸 사람을 고르지 않으면 이메일은 서버 도메인의 `ping@`에서 나가며, 그 도메인은 이메일 서비스에서 인증되어 있어야 합니다. 나중에 설정하려면 설치를 다시 실행하세요.",
        ],
      },
      {
        id: "phone",
        heading: "휴대폰",
        blocks: [
          {
            list: [
              "Tailscale을 쓴다면 휴대폰에 Tailscale 앱을 설치하고 같은 tailnet에 로그인하세요.",
              "agentes.chat 앱을 설치하세요.",
              "설정이 보여 준 QR 코드나 **설정\u00a0›\u00a0내 계정\u00a0›\u00a0휴대폰에서 열기**의 QR 코드를 스캔하세요. 뒤의 것은 로그인까지 해 줍니다.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "에이전트의 컴퓨터",
        blocks: [
          "설정에서 이 서버를 에이전트의 컴퓨터로도 만들 수 있습니다. 에이전트는 거기서 명령을 실행하고 브라우저를 쓰고 파일을 둡니다. 설정이 물어보며, 서버가 잘 감당할 수 있을 때 예를 제안합니다. Debian 13에서는 에이전트마다 화면이 있는 자기 사용자가 생깁니다. Ubuntu에서는 에이전트가 `agentes`라는 사용자 하나를 함께 씁니다. 아니요라고 답했다면 `--computer yes`를 붙여 설치를 다시 실행하세요.",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "agentes.chat 앱이 있는 Mac이나 다른 서버 같은 컴퓨터는 **설정\u00a0›\u00a0기기**에서 연결합니다([내 컴퓨터와 휴대폰](/help/computers) 참고). Tailscale을 쓴다면 먼저 내 tailnet에 들어가야 합니다.",
        ],
      },
      {
        id: "backups",
        heading: "백업과 복원",
        blocks: [
          "서버는 세 가지로 이루어집니다. 데이터베이스, 올린 파일, 그리고 `.env`의 `AGENTES_SECRET`입니다. `.env`의 사본은 백업과 떨어진 안전한 곳에 두세요. 이 비밀이 없으면 복원한 데이터베이스에 저장된 키를 읽을 수 없습니다.",
          "매일 백업하려면 Cloudflare R2나 다른 S3 호환 저장소에 비공개 버킷을 만들고, 그 안에서 읽기, 쓰기, 삭제를 할 수 있는 키를 만드세요. 이를 `.env`에 넣고 `COMPOSE_PROFILES`에 `backup`을 더하세요(공개 도메인이라면 `https,backup`).",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "그런 다음 설치 폴더에서 `docker compose up -d`를 실행하세요. 데이터베이스는 03:00 UTC에 덤프되고 각 덤프는 14일 동안 보관됩니다. `docker compose run --rm backup now`는 바로 하나를 만들고, `docker compose run --rm backup list`는 목록을 보여 줍니다. 덤프에는 데이터베이스만 들어갑니다. `files` 볼륨에 있는 올린 파일은 따로 복사해야 하며, 그 명령은 아래의 전체 안내에 있습니다.",
          "복원하려면 `docker compose run --rm -T backup fetch <이름> > agentes.dump`로 덤프를 받은 뒤, 앱을 멈춘 상태에서 빈 데이터베이스에 불러오세요.",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "덤프를 만든 버전이나 그보다 새 버전에 복원하세요.",
        ],
      },
      {
        id: "upgrades",
        heading: "업데이트",
        blocks: [
          "설치 폴더에서 다음을 실행하세요.",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "새 버전이 시작되면 데이터베이스는 알아서 업데이트됩니다. 설정은 `.env`에 두고 `docker-compose.yml`은 고치지 마세요. 업데이트할 때마다 바뀝니다. 크게 올리기 전에는 백업하세요. 새 버전이 업데이트한 데이터베이스는 이전 버전에서 열리지 않습니다.",
        ],
      },
      {
        id: "data",
        heading: "보내는 정보",
        blocks: [
          "서버는 하루에 한 번 agentes.chat에 익명 사용 통계를 보냅니다. 사람 수, 에이전트 수, 기기 크기, 사용한 AI 토큰, 에이전트의 브라우저가 주고받은 데이터 양 같은 숫자입니다. 메시지, 파일, 이름, 사이트는 보내지 않습니다. `docker compose run --rm agentes telemetry`는 보낼 내용을 그대로 보여 줍니다. 소유자는 **설정\u00a0›\u00a0일반**이나 `.env`의 `TELEMETRY=off`로 끌 수 있습니다.",
          "오류 보고는 직접 고른 Sentry 호환 서버를 `SENTRY_DSN`에 설정하지 않는 한 어디에도 가지 않습니다. 보고에는 오류와 발생 위치가 들어가며, 메시지, 이메일, IP 주소, 쿠키, 토큰은 들어가지 않습니다.",
        ],
      },
      {
        id: "reference",
        heading: "전체 안내",
        blocks: [
          "모든 설정, nginx 같은 자체 프록시, Docker 없이 실행하기, 직접 설치하는 AI 에이전트를 위한 절차, 문제가 생겼을 때 할 일은 agentes.chat 저장소의 `SELF_HOSTING.md`에 있습니다.",
        ],
      },
    ],
  },
};
