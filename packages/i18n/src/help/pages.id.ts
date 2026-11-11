import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

/** The help pages in id: a page not here shows in English. */
export const helpId: Partial<Record<HelpSlug, HelpDocument>> = {
  "run-on-your-computer": {
    title: "Jalankan agentes.chat di komputermu",
    summary:
      "Aplikasi agentes.chat juga bisa menjalankan agentes.chat sendiri, di Mac, PC, atau komputer Linux, untukmu atau tim kecil.",
    sections: [
      {
        id: "how",
        heading: "Cara kerjanya",
        blocks: [
          "agentes.chat berjalan di dalam aplikasi, dengan database bawaannya sendiri, dan menyimpan semuanya di satu folder di komputer ini, `.agentes` di folder pribadimu. Tidak ada lagi yang perlu dipasang: tanpa Docker, tanpa database yang perlu disiapkan.",
          "agentes.chat menyala bersama aplikasi dan berhenti saat kamu menutupnya. Aplikasi bertanya dulu sebelum ditutup, karena tidak ada yang bisa memakai agentes.chat sampai aplikasinya dibuka lagi.",
        ],
      },
      {
        id: "who",
        heading: "Untuk siapa",
        blocks: [
          "Kamu atau tim kecil. Mac mini, PC cadangan, atau laptop yang tetap menyala cocok jadi rumahnya: siapkan seperti di [Biarkan tetap menyala](#keep-on). Di Mac atau PC, aplikasi inilah cara menjalankan agentes.chat tanpa Docker.",
          "Untuk tim yang lebih besar, lihat [Pilih cara penyiapan](/help/install-on-a-server#choose). Datamu bisa dipindahkan ke server nanti.",
        ],
      },
      {
        id: "keep-on",
        heading: "Biarkan tetap menyala",
        blocks: [
          "Di komputer yang juga diandalkan orang lain, siapkan sekali saja:",
          {
            list: [
              "**Buka saat login** menyala sendiri setelah penyiapan.",
              "Di Mac, nyalakan **Login otomatis** di **Pengaturan Sistem\u00a0›\u00a0Pengguna & Grup**, supaya aplikasinya terbuka setelah restart. FileVault mematikan login otomatis.",
              "Di Mac, nyalakan **Mulai secara otomatis setelah listrik padam** di **Pengaturan Sistem\u00a0›\u00a0Energi**.",
              "Mac tetap terjaga selama server berjalan dan **Akses dari ponselmu dan rekan tim** menyala. Di Windows dan Linux, matikan mode tidur di pengaturan daya sistem.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "Agen-agenmu juga bekerja di sini",
        blocks: [
          "Agen-agenmu juga bekerja di komputer ini, di folder mereka sendiri, dengan browser, dan dengan Claude Code atau Codex kalau terpasang di sini.",
          "Agen di sini berjalan sebagai kamu. **Perintah** menyala sejak awal, dan dengan itu agen dari setiap ruang kerja yang memakai komputer ini bisa menjangkau semua isinya, termasuk data server. Matikan di **Preferensi\u00a0›\u00a0Alat**. Lihat [Apa yang bisa dijangkau agen](/help/computers#reach).",
        ],
      },
      {
        id: "another-workspace",
        heading: "Pinjamkan juga ke ruang kerja lain",
        blocks: [
          "Ruang kerja dari server yang kamu jalankan di sini memakai komputer ini dengan sendirinya. Supaya ruang kerja di tempat lain juga bisa memakainya, misalnya ruang kerja di agentes.chat Cloud, buka **Preferensi\u00a0›\u00a0Server**, tekan **Tambah server…**, masuk ke ruang kerja itu, lalu tekan **Izinkan** saat aplikasi bertanya.",
          "Tiap ruang kerja punya agen dan foldernya sendiri di sini. **Perintah** juga menyala sejak awal untuknya. Matikan di pertanyaan aplikasi sebelum menekan **Izinkan**, atau nanti di **Preferensi\u00a0›\u00a0Alat**, tempat satu tombol berlaku untuk semua ruang kerja di komputer ini.",
        ],
      },
      {
        id: "reach",
        heading: "Dari ponselmu dan timmu",
        blocks: [
          "**Akses dari ponselmu dan rekan tim** menaruh agentes.chat di Tailscale, jaringan pribadi untuk perangkatmu: ponselmu dan orang yang kamu undang bergabung ke jaringan itu, dan tidak ada orang lain yang bisa menjangkau agentes.chat. Tailscale gratis: https://tailscale.com/download. Kalau dimatikan, agentes.chat hanya bisa dipakai di komputer ini.",
          "Kalau komputer ini sudah membagikan hal lain di port 443 Tailscale, agentes.chat memakai port 8443, dan alamatnya diakhiri `:8443`.",
        ],
      },
      {
        id: "password",
        heading: "Masuk dari perangkat lain",
        blocks: [
          "Awalnya pemilik tidak punya kata sandi: aplikasi memasukkanmu di komputer ini. Untuk masuk dari browser di komputer lain, tambahkan kata sandi di **Pengaturan\u00a0›\u00a0Akunmu**. Aplikasi ponsel terhubung dengan memindai kode QR di bawah **Di ponselmu**, di **Preferensi\u00a0›\u00a0Server**. Untuk itu, **Akses dari ponselmu dan rekan tim** harus menyala.",
        ],
      },
      {
        id: "updates",
        heading: "Pembaruan",
        blocks: [
          "Aplikasi mencari pembaruan sendiri, dan memasangnya saat kamu menekan **Perbarui dan buka ulang** di **Preferensi\u00a0›\u00a0Pembaruan**. Server dan semua agen ikut dimulai ulang. Database disalin dulu, dan kalau versi baru tidak merespons dalam 3 menit, aplikasi kembali sendiri ke versi sebelumnya beserta datanya.",
        ],
      },
      {
        id: "backups",
        heading: "Cadangan",
        blocks: [
          "Belum ada yang dicadangkan otomatis. **Cadangkan sekarang**, di **Preferensi\u00a0›\u00a0Server**, menghentikan server sebentar lalu menyimpan database, file, dan `.env` di `.agentes/backups`, di folder pribadimu. Dua cadangan terbaru yang disimpan.",
          "Sesekali salin cadangan itu ke luar komputer ini, ke disk atau penyimpanan cloud. Isinya kunci-kuncimu: jaga kerahasiaannya.",
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code dan Codex",
        blocks: [
          "Aplikasi mencari Claude Code dan Codex lewat `PATH` shell login-mu, ditambah folder yang biasa seperti `~/.local/bin`, `/opt/homebrew/bin`, dan `/usr/local/bin`. Kalau **Preferensi\u00a0›\u00a0Alat** menampilkan **Tidak ditemukan**, pastikan `claude` atau `codex` bisa berjalan di jendela Terminal baru, lalu tutup dan buka lagi aplikasinya.",
        ],
      },
      {
        id: "moving",
        heading: "Pindah ke server",
        blocks: [
          {
            list: ["Tutup aplikasi, lalu buat dump database dengan salinan server milik aplikasi itu sendiri. Di Mac:"],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[Pasang agentes.chat di server](/help/install-on-a-server), tapi jangan dijalankan dulu. Di `.env`-nya, isi `AGENTES_SECRET` dari `~/.agentes/.env`, lalu jalankan databasenya saja: `docker compose up -d postgres`.",
              "Muat dump-nya: `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "Jalankan dengan `docker compose up -d`, salin `~/.agentes/files` ke dalamnya seperti di panduan lengkap, lalu masuk seperti sebelumnya.",
            ],
          },
        ],
      },
    ],
  },
  computers: {
    title: "Komputer dan ponselmu",
    summary:
      "Bawa Mac, PC, komputer Linux, server, atau ponsel, dan agen-agenmu bekerja di sana. Sama saja di agentes.chat Cloud maupun di server milikmu sendiri.",
    sections: [
      {
        id: "app",
        heading: "Dari aplikasi agentes.chat",
        blocks: [
          "Pasang aplikasi di komputer itu, buka, lalu masuk ke ruang kerjamu. Aplikasi bertanya **Izinkan agen <workspace> memakai Mac ini?** (PC ini di Windows, komputer ini di Linux). Pilih siapa yang boleh memakainya lalu tekan **Izinkan**. Selesai.",
          "Sudah masuk? Nyalakan ruang kerjanya di **Preferensi\u00a0›\u00a0Umum**, di kartu **Agen**.",
        ],
      },
      {
        id: "web",
        heading: "Dari situs",
        blocks: [
          "Di **Pengaturan\u00a0›\u00a0Perangkat**, tekan **Hubungkan perangkat**:",
          {
            list: [
              "**Mac ini** atau **PC ini**: membuka aplikasi, yang bertanya dulu kepadamu.",
              "**Komputer lain**: pasang aplikasi di sana, masuk dengan akunmu sendiri, lalu tekan **Izinkan**. Komputer itu muncul di sini dengan sendirinya.",
              "**Server atau VPS**: jalankan satu baris di terminalnya, lalu izinkan server itu bergabung. Baris itu hanya berlaku sekali, selama 10 menit.",
            ],
          },
          "Aplikasi terhubung dengan satu klik hanya ke alamat https, seperti alamat Tailscale yang diakhiri `.ts.net`. Untuk alamat http biasa, pakai baris terminal.",
        ],
      },
      {
        id: "phones",
        heading: "Ponsel",
        blocks: [
          "Ponsel Android terhubung lewat komputer mana pun yang sudah terhubung: dengan kabel, atau lewat Wi-Fi di Android 14 ke atas dengan pembaruan keamanan Mei 2026. iPhone terhubung lewat Mac yang punya aplikasinya dan Xcode, dan aplikasinya menyiapkan sisanya. Keduanya dimulai dari **Hubungkan perangkat**.",
        ],
      },
      {
        id: "who",
        heading: "Siapa yang bisa memakainya",
        blocks: [
          "Perangkat baru hanya untukmu: **Hanya saya** berarti kamu dan agen yang bekerja untukmu. Buka untuk semua orang di ruang kerja, atau untuk orang dan peran tertentu, saat kamu mengizinkannya atau nanti di halamannya di **Pengaturan\u00a0›\u00a0Perangkat**.",
        ],
      },
      {
        id: "open",
        heading: "Selama aplikasinya terbuka",
        blocks: [
          "Agen bekerja di komputer hanya selama aplikasi berjalan di sana dan komputernya tidak tidur. Saat aplikasi bertanya, biarkan **Tetap siap: buka agentes.chat saat login** tercentang. Komputer yang mati atau tidur tampil **Offline**, dan agen menunggu sampai komputernya kembali.",
        ],
      },
      {
        id: "pausing",
        heading: "Menjeda dan memutuskan",
        blocks: [
          "Di komputer itu, ikon agentes.chat di dekat jam menjeda agen dari semua ruang kerja. Di **Preferensi\u00a0›\u00a0Umum**, sakelar tiap ruang kerja hanya menjeda ruang kerja itu, dan **Keluar** memutuskannya. Selama dijeda tidak ada yang baru dimulai, dan yang sedang berjalan tetap diselesaikan. Folder agen tetap tersimpan di disk setelah diputuskan.",
          "Dari situs, **Hapus** di halaman perangkat memutuskannya.",
        ],
      },
      {
        id: "organizations",
        heading: "Beberapa ruang kerja, satu komputer",
        blocks: [
          "Masuk ke tiap ruang kerja di aplikasi yang sama lalu tekan **Izinkan** untuk masing-masing. Ruang kerja di agentes.chat Cloud dan di server milikmu sendiri bisa berbagi satu komputer (aplikasi 0.6.1 ke atas). Masing-masing punya agen dan foldernya sendiri di sana, dan memutuskan satu ruang kerja tidak memengaruhi yang lain.",
          "Server yang dijalankan aplikasi di komputer ini sudah terhubung dan tidak perlu apa-apa. Untuk meminjamkan komputer itu juga ke ruang kerja di tempat lain, lihat [Pinjamkan juga ke ruang kerja lain](/help/run-on-your-computer#another-workspace).",
          "Memakai aplikasi di laptop hanya sebagai jendela ke ruang kerjamu? Saat aplikasi meminta izin agar agen memakai laptop itu, **Nanti saja** membuatnya tetap jadi jendela biasa.",
        ],
      },
      {
        id: "folders",
        heading: "Folder",
        blocks: [
          "Tiap agen selalu punya foldernya sendiri, di `~/agentes/<workspace>`. Folder lain hanya bisa diizinkan dari komputer itu sendiri, tidak pernah dari situs: di aplikasi, **Preferensi › Folder**, atau dengan `agentes-runner folders allow` di server. Tiap ruang kerja mengizinkan foldernya sendiri: yang kamu izinkan untuk satu ruang kerja hanya berlaku untuk agen-agennya. Menghapus folder dari daftar tidak menghapus apa pun. Itu hanya mencabut aksesnya.",
        ],
      },
      {
        id: "reach",
        heading: "Apa yang bisa dijangkau agen",
        blocks: [
          "Agen berjalan sebagai kamu, pengguna komputer itu. Alat file mereka tetap di folder mereka, tapi sebuah perintah bisa membaca apa pun yang bisa kamu baca:",
          {
            list: [
              "file dan akun-akun yang kamu masuki",
              "folder agen lain, termasuk milik ruang kerja lain, dan login yang disimpan browser mereka",
              "token yang menghubungkan komputer ini",
              "di komputer yang juga menjalankan agentes.chat, database dan kuncinya di `.agentes`",
            ],
          },
          "agentes.chat menolak perintah yang menyebut kunci, token, dan data login, tapi itu aturan, bukan tembok. **Perintah** menyala sejak awal. Matikan di pertanyaan aplikasi sebelum menekan **Izinkan**, atau nanti di **Preferensi\u00a0›\u00a0Alat**, tempat satu tombol berlaku untuk semua ruang kerja di komputer itu. Claude Code dan Codex menjalankan perintahnya sendiri di folder agen, dengan aturannya sendiri.",
          "Untuk tembok sungguhan, pakai server Linux. Di Debian 13, kalau dipasang dengan `--system`, tiap agen jadi pengguna tersendiri. Di Ubuntu, agen berbagi satu pengguna, `agentes`: mereka bisa melihat folder satu sama lain, tapi bukan foldermu atau folder server. Atau beri agen komputer milik mereka sendiri.",
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "Komputer ruang kerja",
    summary: "Tiap ruang kerja mendapat komputernya sendiri, selalu menyala, tempat agen-agennya bekerja.",
    sections: [
      {
        id: "what",
        heading: "Apa itu",
        blocks: [
          "Komputer khusus untuk ruang kerja ini, selalu menyala. Tiap agen punya pengguna sendiri di sana, dengan folder, layar, browser, dan file miliknya. Dari halaman agen kamu bisa melihatnya bekerja, dan mengambil alih saat perlu.",
        ],
      },
      {
        id: "own",
        heading: "Komputer dan ponselmu sendiri",
        blocks: [
          "Agen juga bisa bekerja di komputer dan ponsel yang kamu bawa: Mac atau PC dengan aplikasi agentes.chat, server, ponsel Android, atau iPhone. Lihat [Komputer dan ponsel yang kamu bawa](/help/computers).",
        ],
      },
      {
        id: "plans",
        heading: "Paket AI kamu",
        blocks: [
          "Agen-agenmu bisa berpikir dengan paket AI milikmu, seperti Claude, ChatGPT, GLM, atau Kimi, yang masuk di komputer ini: tanpa perlu kunci API. Akunnya tetap di komputer ini, dan agentes.chat tidak pernah melihat kata sandi atau aksesnya.",
          "Paket AI Pro dan Ultra dari Google tidak bisa dipakai di sini: ketentuan Google tidak mengizinkannya di produk lain. Kunci API Gemini bisa.",
        ],
      },
      {
        id: "size",
        heading: "Ukurannya",
        blocks: ["CPU, memori, dan disknya terlihat di **Pengaturan\u00a0›\u00a0Perangkat**."],
      },
      {
        id: "trouble",
        heading: "Kalau tidak merespons",
        blocks: [
          "Biasanya komputer ini kembali dalam beberapa menit, dan kami sedang menanganinya: kamu tidak perlu melakukan apa-apa.",
        ],
      },
    ],
  },
  import: {
    title: "Bawa agen-agenmu",
    summary:
      "Bawa agen dari aplikasi lain, atau dari ruang kerja agentes.chat lain, lengkap dengan instruksi, skill, rutinitas, dan memorinya.",
    sections: [
      {
        id: "comes",
        heading: "Apa yang ikut dibawa",
        blocks: [
          {
            list: [
              "Agen, dengan nama, peran, instruksi, dan tampilannya.",
              "Skill, menyala untuk agen yang memilikinya.",
              "Kanal publik, dengan agen-agen di dalamnya.",
              "Rutinitas, aktif dan sesuai jadwalnya. Jeda di **Rutinitas** kalau kamu mau.",
              "Memori: apa yang diingat tiap agen.",
              "File milik tiap agen (folder files di OpenBot.run, ruang kerja OpenClaw), di folder dengan namanya di **Drive**. Kunci, info masuk, dan file sistem tidak dibawa, dan tidak ada yang sudah ada di sana yang ditimpa.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "Apa yang tidak pernah dibawa",
        blocks: [
          "Kunci, kata sandi, info masuk, dan riwayat chat tidak pernah dibawa: agen berpikir dengan AI milik ruang kerja. Beberapa hal belum punya padanan di sini, atau tidak boleh dipindahkan lewat file. Kamu bisa membuatnya lagi nanti.",
          "File dan folder dibaca di browsermu. Tautan GitHub diproses lewat server ruang kerja. File kunci dan info masuk tidak pernah dibuka, dan tidak ada yang berubah sampai kamu mengonfirmasi.",
        ],
      },
      {
        id: "other-apps",
        heading: "Dari aplikasi lain",
        blocks: [
          "Pilih **Grok Bot**, **ChatGPT dots**, atau **Aplikasi lain**. Salin permintaannya, tempel di aplikasi itu, lalu bawa kembali hasilnya: taruh filenya, atau tempel seluruh balasannya. Tempat menaruhnya di tiap aplikasi:",
          {
            list: [
              "**Grok Bot**: di chat dengan bot kamu. Bot membalas dengan JSON: salin seluruh balasannya.",
              "**ChatGPT dots**: di chat baru. Unduh file yang dibuatnya.",
              "**Claude**: di percakapan baru, atau di proyek agen-agenmu. Unduh file yang dibuatnya.",
              "**Manus**: di tugas baru. Filenya ada di hasil tugas.",
              "**Rakazo**: kirim ke agenmu. Agen membalas dengan JSON: salin seluruh balasannya.",
              "**OpenBot**: tidak perlu permintaan. Seret folder tenant (agents.yaml, agents/, model.yaml, skills.yaml) atau tempel tautan GitHub-nya.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "Ekspor ruang kerja",
        blocks: [
          "**Pengaturan › Impor dan ekspor › Ekspor** mengunduh file .json, untuk membawa agen-agenmu ke ruang kerja lain atau menyimpan salinannya. Isi filenya:",
          {
            list: [
              "Agen, dengan instruksi, model, dan tampilannya",
              "Skill, dengan SKILL.md lengkap",
              "Kanal publik, dengan agen-agennya",
              "Rutinitas terjadwal (langsung aktif di ruang kerja tujuan)",
              "Memori yang bisa dilihat semua orang di ruang kerja",
            ],
          },
          "Tidak pernah ada di dalamnya:",
          {
            list: [
              "Kunci API dan kata sandi",
              "Konektor dan info masuk",
              "Komputer",
              "Percakapan, pesan, dan kanal privat",
              "Pemakaian, biaya, dan riwayat aktivitas",
            ],
          },
          "Untuk memakai filenya, buka **Pengaturan › Impor dan ekspor** di ruang kerja lain lalu taruh file .json-nya.",
        ],
      },
    ],
  },
  wiki: {
    title: "Wiki",
    summary: "Apa yang diketahui perusahaan, dalam halaman yang saling terhubung.",
    sections: [
      {
        id: "links",
        heading: "Tautan",
        blocks: ["Ketik [[ untuk menautkan halaman lain. Tautan balik dan grafik menunjukkan hubungan antarhalaman."],
      },
      {
        id: "agents",
        heading: "Cara agen memakainya",
        blocks: ["Agen membaca wiki saat menjawab. Mereka hanya menulis di sana kalau ada yang meminta."],
      },
      {
        id: "obsidian",
        heading: "Bawa vault Obsidian",
        blocks: [
          "Taruh folder vault, atau file .zip-nya, di langkah Konteks saat penyiapan atau di impor milik wiki. [[Tautan]], [[note|alias]], dan [[note#section]] tetap berfungsi. Tag diambil dari frontmatter dan teksnya. Lampiran masuk ke Drive, dan gambar serta file yang disematkan menjadi kartu di halaman. Callout tetap menjadi callout. Kueri Dataview masuk sebagai teks: minta agen membuat tabelnya. Canvas dan pengaturan Obsidian (.obsidian) tidak dibawa.",
        ],
      },
    ],
  },
  memory: {
    title: "Memori",
    summary: "Apa yang dipelajari tiap agen dari percakapan dan koreksi tim.",
    sections: [
      {
        id: "learns",
        heading: "Cara agen belajar",
        blocks: [
          "Agen belajar dari percakapan dan dari koreksi tim. Apa yang diketahui agen masuk ke konteksnya saat relevan. Di tab **Memori** miliknya, ubah, sematkan, atau arsipkan yang salah atau sudah usang.",
        ],
      },
      {
        id: "permissions",
        heading: "Memori tidak memberi izin",
        blocks: [
          "Tidak ada isi memori yang membuat agen bisa berbuat lebih. Apa yang bisa dilakukannya tetap diatur di **Alat dan akses**, dan tindakan sensitif selalu meminta persetujuan.",
        ],
      },
      {
        id: "proposals",
        heading: "Usulan perubahan",
        blocks: [
          "Kalau sebuah pelajaran terulang, agen bisa mengusulkan perubahan pada instruksinya sendiri atau pada konteks ruang kerja. Tidak ada yang berubah sampai seseorang menerimanya, dan teksnya bisa disesuaikan dulu. Versi sebelumnya tetap ada di riwayat. Usulan yang ditolak disimpan sebagai pelajaran, jadi tidak diusulkan lagi.",
        ],
      },
    ],
  },
  approvals: {
    title: "Persetujuan",
    summary: "Tindakan sensitif menunggu seseorang, sekali atau untuk seterusnya.",
    sections: [
      {
        id: "what",
        heading: "Apa yang meminta izin dulu",
        blocks: [
          "Saat agen ingin melakukan merge, deploy, rollback, mengirim sesuatu ke luar, atau menghapus data, agen meminta izin dulu, apa pun akses yang dimilikinya. Permintaannya muncul di **Persetujuan** dan di percakapan, dengan tindakan persisnya dan alasannya.",
        ],
      },
      {
        id: "always",
        heading: "Sekali, atau selalu",
        blocks: [
          "Menyetujui berlaku untuk satu tindakan persis, dengan nilai-nilainya. Kalau agen mengubah apa pun, agen meminta lagi.",
          "**Selalu setujui** membuat agen boleh melakukan jenis tindakan itu mulai sekarang, dengan nilai apa pun, tanpa meminta. Pada permintaan rutinitas, **Selalu di rutinitas ini** melakukan hal yang sama hanya untuk rutinitas itu. Keduanya tidak pernah ditawarkan untuk merge, deploy, rollback, dan sejenisnya. Untuk membatalkannya, buka **Alat dan akses** di halaman agen, atau pengaturan rutinitas.",
        ],
      },
      {
        id: "who",
        heading: "Siapa yang menyetujui",
        blocks: [
          {
            list: [
              "Pemilik agen, untuk permintaannya.",
              "Siapa pun yang perannya punya **Setujui tindakan agen**, untuk semua agen.",
              "Orang yang disebut agen saat meminta, menggantikan pemiliknya.",
              "Orang yang menggantikan seseorang di **Siapa yang menyetujui untukku**, untuk apa yang diminta dari orang itu. Merge, deploy, dan tindakan berisiko lainnya hanya kalau itu dinyalakan.",
            ],
          },
          "Tindakan di kotak surat milik seseorang hanya menunggu orang itu. Akses baru untuk agen menunggu orang yang mengelola agen.",
          "Lodi, tangan kananmu, juga bisa menyetujui untukmu agen baru yang diusulkan agen lain dan perubahan model, anggaran, serta kanal sebuah agen, hanya kalau kamu yang memintanya. Siapa yang menggantikanmu dan apa yang disetujui Lodi dipilih di **Pengaturan\u00a0›\u00a0Kamu\u00a0›\u00a0Persetujuan**.",
        ],
      },
      {
        id: "refusing",
        heading: "Menolak",
        blocks: [
          "Sebutkan alasannya kalau kamu mau: agen membacanya, menyesuaikan rencananya, dan menyimpannya sebagai pelajaran.",
        ],
      },
      {
        id: "meetings",
        heading: "Rapat",
        blocks: ["Agen hanya menyarankan waktu. Undangan ke orang selalu dikirim lewat orang yang meminta."],
      },
    ],
  },
  "who-answers": {
    title: "Siapa yang menjawab pesan",
    summary: "Sebutan memilih agennya. Tanpa sebutan, agentes.chat memilihkan untukmu, dengan urutan ini.",
    sections: [
      {
        id: "order",
        heading: "Cara pesan menemukan agennya",
        blocks: [
          "Pesan yang @menyebut agen masuk ke agen itu. Pesan yang tidak menyebut siapa pun dibaca oleh yang pertama dari daftar ini yang dimiliki ruang kerja:",
          {
            list: [
              "**Jev**, model kecil dan cepat yang dibuat untuk keputusan seperti ini.",
              "**Model kecil dengan salah satu kunci API ruang kerja**, seperti Claude Haiku 5.5 atau GPT-6 Luna.",
              "**Paket Claude atau ChatGPT milikmu**, untuk pesan yang kamu tulis, di server yang kamu jalankan sendiri. Paket ini membacanya di komputer tempat paket itu masuk, dan butuh beberapa detik.",
              "**Aturan sederhana**: balasan ke agen masuk ke agen itu, begitu juga pesan lanjutan tepat setelah kamu bicara dengannya, atau pesan di kanal tempat kamu hanya berdua dengan satu agen.",
            ],
          },
          "Kalau tidak ada yang cocok, tidak ada agen yang menjawab. Sebut agen untuk memanggilnya.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "Saat agentes.chat menjadi host ruang kerjamu, Jev sudah termasuk. Di server yang kamu jalankan sendiri, Jev memakai kunci TypeSafe milik pemilik, sekitar US$ 0,0001 per pesan: [Siapkan Jev](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "Kenapa paketmu hanya memilih untuk pesanmu",
        blocks: ["Paket Claude dan ChatGPT bersifat pribadi, jadi paketmu hanya memilih untuk pesan yang kamu tulis."],
      },
      {
        id: "see",
        heading: "Melihat siapa yang memilih",
        blocks: ["Buka tanda centang di bawah pesan. Baris terakhirnya menyebut siapa yang memilih agennya."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "Model cepat dari TypeSafe yang membuat keputusan cepat untuk agen-agenmu. Di servermu sendiri sifatnya opsional, dengan kunci milikmu.",
    sections: [
      {
        id: "what",
        heading: "Apa yang dilakukannya",
        blocks: [
          {
            list: [
              "**Memilih siapa yang menjawab.** Pesan yang tidak @menyebut siapa pun masuk ke agen yang tepat dalam waktu kurang dari sedetik, bahkan saat agen-agenmu berpikir dengan paket dan kamu tidak punya kunci API.",
              "**Merapikan memori.** Jev mengenali pengulangan atau fakta yang lebih baru meski dengan kata-kata lain: pengulangan digabung dengan yang sudah diketahui agen, dan fakta yang lebih baru menggantikan yang lama. Sekali sehari Jev merapikan sisanya.",
              "**Melihat layar.** Di browser dan desktop mereka, agen menemukan tombol dan kolom dari deskripsi, melihat lebih dekat yang kecil, dan memeriksa di gambar layar bahwa sebuah langkah berhasil.",
              "**Membaca lebih sedikit.** Tiap giliran hanya memuat alat yang kemungkinan dibutuhkan agen, jadi AI kamu membaca lebih sedikit dan biayanya lebih rendah.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Tanpa Jev",
        blocks: [
          "Semuanya tetap berjalan, lebih lambat dan kurang teliti.",
          {
            list: [
              "**Siapa yang menjawab:** model kecil dengan salah satu kunci API kamu yang memilih, seperti Claude Haiku 5.5 atau GPT-6 Luna. Tanpa kunci, paket Claude atau ChatGPT milik tiap orang memilih untuk pesan yang ditulisnya, dalam beberapa detik. Kalau tidak, balasan atau pesan lanjutan tetap sampai ke agennya. Sebut agen untuk memanggilnya. [Cara agen dipilih](/help/who-answers)",
              "**Memori:** pengulangan dengan kata-kata yang sama tetap digabung. Pengulangan dan pembaruan dengan kata-kata lain tetap terpisah.",
              "**Layar:** agen memakai angka yang tampil di layar dan nama persisnya. Tidak ada yang dibaca dari gambar.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "Siapkan Jev",
        blocks: [
          {
            list: [
              "Buka https://console.typesafe.ai lalu masuk dengan Google atau emailmu. Akun baru dibuat dengan cara yang sama.",
              "Tambahkan saldo di konsol. Jev memakai sistem prabayar.",
              "Buka https://console.typesafe.ai/keys, buat kunci, lalu langsung salin.",
              "Di agentes.chat, buka **Pengaturan › AI dan pemakaian** lalu tempel di bawah **Jev**. Hanya orang yang menyiapkan server ini yang bisa melihatnya.",
            ],
          },
          "Di server yang kamu jalankan dengan Docker, kamu juga bisa menaruh kuncinya di `.env` sebagai `TYPESAFE_API_KEY`. Kunci itu lebih diutamakan daripada yang ada di Pengaturan.",
        ],
      },
      {
        id: "cost",
        heading: "Biayanya",
        blocks: [
          {
            list: [
              "US$ 0,042 per sejuta token yang dibaca Jev. Jawabannya gratis. Memilih siapa yang menjawab membaca sekitar 2.500 token, jadi sekitar US$ 0,0001. Satu tangkapan layar sekitar 3.900 token.",
              "Saldo yang kamu beli berlaku 12 bulan. Nyalakan isi ulang otomatis di konsol supaya saldo Jev tidak habis.",
              "**Pengaturan › AI dan pemakaian** menampilkan berapa banyak keputusan yang dibuat Jev bulan ini, dan biayanya.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "Datamu",
        blocks: [
          "Yang dibaca Jev untuk memutuskan:",
          {
            list: [
              "Nama dan deskripsi kanal, pesannya, dan beberapa pesan sebelumnya",
              "Nama dan peran agen-agenmu, awal instruksinya, dan alat yang bisa mereka pakai",
              "Butir memori yang dibandingkannya",
              "Tugas agen dan awal hasil alatnya",
              "Tujuan misi dan perintah yang ingin dijalankan agen untuk misi itu",
              "Alat yang ditawarkan aplikasi yang terhubung",
              "Halaman atau layar yang sedang dipakai agen, termasuk tangkapan layar",
            ],
          },
          "TypeSafe menjalankan Jev di Amerika Serikat dan tidak melatih modelnya dengan apa yang kamu kirim. TypeSafe menyimpan data selama dibutuhkan untuk menjalankan layanannya. Retensi nol tersedia di paket enterprise-nya.",
          "Kebijakan privasi TypeSafe: https://typesafe.ai/legal/privacy-policy. Perjanjian pemrosesan datanya: https://typesafe.ai/legal/data-processing.",
        ],
      },
      {
        id: "problems",
        heading: "Saat Jev berhenti",
        blocks: [
          {
            list: [
              "**Kunci tidak diterima:** buat kunci baru lalu tempel di **Pengaturan › AI dan pemakaian**.",
              "**Saldo habis:** tambahkan saldo di konsol. Jev mencoba lagi dalam 30 menit, atau klik **Periksa lagi**.",
              "**Sibuk atau tidak bisa dijangkau:** TypeSafe bisa membatasi permintaan per detik, atau berhenti menjawab sementara. Jev akan lanjut lagi dengan sendirinya. Batasmu: https://console.typesafe.ai/rate-limits. Untuk batas yang lebih tinggi, kirim email ke sales@typesafe.ai.",
            ],
          },
          "Sementara itu, agen bekerja seperti di [Tanpa Jev](/help/jev#without).",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "Aplikasi AI",
    summary:
      "Minta tugas ke agen-agen agentes.chat dari Claude, Cursor, atau aplikasi MCP lain, tanpa meninggalkannya, dan dapatkan jawabannya di sana.",
    sections: [
      {
        id: "what",
        heading: "Cara kerjanya",
        blocks: [
          "agentes.chat adalah server MCP. Kamu menempel alamatnya di aplikasi AI kamu, masuk dengan akunmu, dan memilih ruang kerja. Sejak itu, aplikasinya bisa melihat daftar agen dan kanal, mengirim tugas ke agen atas namamu, menunggu balasannya, dan membaca tugas terbaru.",
          'Misalnya, di tengah mengerjakan adegan di Unity atau Blender, minta ke Claude: "Minta agen marketing membuat teks peluncuran". Pesannya muncul di agentes.chat sebagai pesanmu, bertanda **via Claude**, dan balasan agennya kembali ke Claude.',
          "Alamatnya ada di **Pengaturan › Aplikasi AI**. Alamat itu diakhiri `/mcp`.",
        ],
      },
      {
        id: "connect",
        heading: "Hubungkan aplikasi",
        blocks: [
          {
            list: [
              "**Claude** (claude.ai, Claude Desktop, dan ponsel): di **Sesuaikan › Konektor**, klik **+ Tambah**, lalu **Tambahkan konektor kustom**, beri nama agentes.chat, tempel alamatnya, lalu klik **Lanjutkan**. Pilih **Masuk sekarang**, klik **Tambah**, lalu beri izin. Di paket Team dan Enterprise, Pemilik organisasi Claude menambahkan konektornya di Pengaturan organisasi › Konektor, dan tiap orang mengklik **Hubungkan** di Sesuaikan › Konektor. Paket gratis Claude punya tempat untuk satu konektor kustom.",
              "**Claude Code:** jalankan `claude mcp add --transport http --scope user agentes <address>`, lalu ketik `/mcp`, pilih agentes dan **Authenticate**. Untuk folder saat ini saja, hapus `--scope user`.",
              "**Cursor:** **Tambahkan ke Cursor** di **Pengaturan › Aplikasi AI**, atau tulis alamatnya di `~/.cursor/mcp.json`. Cursor memintamu masuk saat pertama kali dipakai.",
              '**VS Code:** **Tambahkan ke VS Code**, atau tulis alamatnya di `.vscode/mcp.json` dengan `"type": "http"`.',
              "**Aplikasi lain:** ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains, dan lainnya punya langkah masing-masing di **Hubungkan aplikasi**, dengan alamatmu sudah terisi.",
            ],
          },
          "Saat kamu masuk, agentes.chat menampilkan aplikasi mana yang meminta akses dan ke mana aplikasi itu kembali. Lanjutkan hanya kalau kamu baru saja memulai koneksinya.",
        ],
      },
      {
        id: "tools",
        heading: "Apa yang bisa dilakukan aplikasi",
        blocks: [
          {
            list: [
              "`send_to_agent`: mengirim pesan darimu ke agen, di percakapan pribadimu dengannya atau di kanal, lalu menunggu balasannya. Hanya dengan akses **Membaca dan mengirim tugas ke agen**.",
              "`wait_for_reply`: terus menunggu balasan sebuah tugas.",
              "`list_agents`: agen yang bisa kamu lihat.",
              "`list_channels`: kanal yang bisa kamu baca.",
              "`read_conversation`: pesan terbaru di kanal, utas, atau tugas.",
              "`list_recent_tasks`: tugas yang kamu kirim dari aplikasi dan apa yang sedang dikerjakan agen.",
            ],
          },
          "Aplikasi bertindak atas namamu dan hanya melihat apa yang kamu lihat. Aplikasi tidak pernah menyetujui tindakan agen: saat agen berhenti untuk meminta persetujuan, balasannya memberi tahu hal itu dengan tautan, dan orang yang memutuskan di agentes.chat. Aplikasi juga tidak mengubah pengaturan, anggota, atau izin.",
        ],
      },
      {
        id: "workspace",
        heading: "Satu ruang kerja per koneksi",
        blocks: [
          "Tiap koneksi berlaku untuk ruang kerja yang dipilih saat masuk. Untuk memakai ruang kerja lain, hubungkan aplikasinya lagi lalu pilih ruang kerja itu.",
          "Di **Pengaturan › Aplikasi AI** kamu bisa melihat aplikasi yang terhubung, kapan masing-masing terakhir dipakai, dan memutuskan mana saja. Orang yang mengelola anggota bisa melihat aplikasi seluruh ruang kerja dan juga bisa memutuskannya. Tiap pesan yang dikirim dari aplikasi muncul di Audit.",
        ],
      },
      {
        id: "tokens",
        heading: "Token pribadi",
        blocks: [
          "Untuk skrip dan aplikasi tanpa masuk lewat OAuth, buat token pribadi di **Pengaturan › Aplikasi AI** lalu kirim di header `Authorization: Bearer`. Token hanya ditampilkan sekali, hanya berlaku di ruang kerja tempat token itu dibuat, dan bisa kedaluwarsa dalam 30 hari, 90 hari, 1 tahun, atau tidak pernah.",
          "Di server tanpa https, dari luar komputernya sendiri, pakai token pribadi: masuk lewat OAuth butuh https.",
        ],
      },
      {
        id: "limits",
        heading: "Batas",
        blocks: [
          {
            list: [
              "Hingga 120 permintaan per menit dan 5.000 per hari untuk tiap koneksi.",
              "Hingga 20 pesan per menit dan 500 per hari untuk tiap orang di tiap ruang kerja.",
              "Satu kali menunggu berlangsung hingga 45 detik. Kalau agen masih bekerja, aplikasinya menunggu lagi.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "Teks dari orang lain",
        blocks: [
          "Balasan berisi teks yang ditulis agen dan orang di agentes.chat. Aplikasi menerima teks itu bertanda sebagai konten, bukan instruksi, tetapi sebuah teks tetap bisa mencoba membujuk aplikasi melakukan hal lain. Periksa apa yang akan dilakukan aplikasimu sebelum kamu mengonfirmasi.",
        ],
      },
      {
        id: "problems",
        heading: "Kalau tidak mau terhubung",
        blocks: [
          {
            list: [
              "**Permintaan kedaluwarsa:** halaman masuk berlaku 30 menit dan hanya bisa dipakai sekali. Kembali ke aplikasi lalu hubungkan lagi.",
              "**Aplikasi meminta masuk lagi:** koneksinya diputus, kata sandinya diganti, atau kamu keluar dari ruang kerja. Masuk lagi dari aplikasi.",
              "**Cursor tertahan di info masuk lama:** tutup Cursor, hapus folder `~/.mcp-auth`, lalu hubungkan lagi.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "Pasang agentes.chat di server",
    summary:
      "Jalankan agentes.chat di servermu sendiri, gratis, untuk seluruh timmu. Satu perintah menyiapkan semuanya.",
    sections: [
      {
        id: "choose",
        heading: "Pilih cara penyiapan",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**: untuk tim mana pun, bisa diakses dari mana saja. Kami yang menjalankan, memperbarui, dan mencadangkannya. Tiap ruang kerja mendapat komputernya sendiri, dan di sana tiap agen jadi pengguna tersendiri.",
              "**Komputermu, dengan aplikasinya**: untukmu atau tim kecil, bisa diakses selama komputer itu menyala. Mac mini yang tetap menyala cocok sekali. Kamu memperbaruinya dengan satu klik dan mencadangkannya secara manual. Agen berjalan sebagai kamu di komputer itu.",
              "**Server**: untuk tim yang lebih besar, menyala terus. Kamu memperbaruinya dengan tiga perintah, dan server bisa mencadangkan dirinya sendiri setiap hari. Di Debian 13, tiap agen jadi pengguna tersendiri.",
            ],
          },
          "Dari komputermu ke server: [Pindah ke server](/help/run-on-your-computer#moving). Semuanya bisa membawa agen dari yang lain dengan [Bawa agen-agenmu](/help/import).",
        ],
      },
      {
        id: "need",
        heading: "Yang kamu perlukan",
        blocks: [
          {
            list: [
              "Server atau VPS dengan Linux 64-bit, di x64 atau arm64. Untuk tim kecil, 2 CPU, memori 4 GB, dan disk 20 GB sudah cukup untuk mulai. Di Mac atau PC, [aplikasinya menjalankan agentes.chat](/help/run-on-your-computer) tanpa Docker.",
              "Docker dengan Compose. Di Linux, pemasang menambahkannya kalau belum ada, setelah bertanya dulu.",
              "Cara masuk: akun Tailscale gratis (bawaan, privat, tanpa domain dan tanpa port terbuka), atau domain yang mengarah ke server, dengan port 80 dan 443 terbuka.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "Pasang",
        blocks: [
          "Di server, jalankan:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "Pemasang memasang yang belum ada, lalu menanyakan beberapa hal: cara orang masuk, email, apakah server ini juga jadi komputer agenmu, dan apakah mengirim statistik pemakaian anonim. Tekan Enter untuk jawaban yang disarankan. Semuanya dipasang di `/opt/agentes` (`~/agentes` untuk pengguna yang sudah bisa memakai Docker), dan pertama kali ia mengunduh sekitar 2 GB.",
          "Di akhir, ia menampilkan alamat servermu dan kode QR untuk ponselmu. Menjalankannya lagi aman: pengaturanmu tetap, dan hanya yang kurang yang dilengkapi.",
          "Dengan Node.js 18 atau lebih baru, `npx @agenteschat/setup` di folder kosong adalah penyiapan yang sama. Tanpa Node, ia berjalan dari image aplikasi, di folder saat ini, dan diakhiri dengan perintah yang menyalakan sisanya:",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "Cara orang masuk",
        blocks: [
          {
            list: [
              "**Tailscale**, bawaan: HTTPS privat di `https://agentes.<tailnet-mu>.ts.net`, hanya untuk perangkat di jaringan Tailscale-mu. Sebelum memasang, nyalakan MagicDNS dan HTTPS di https://console.tailscale.com/admin/dns dan buat kunci akses (auth key) di https://console.tailscale.com/admin/settings/keys untuk diminta saat penyiapan.",
              "**Domain publik**: siapa pun di internet bisa membukanya, misalnya di `https://chat.example.com`. Arahkan domain ke server dan buka port 80 dan 443. Penyiapan mengambil sertifikat dan memperbaruinya, dan memintamu membuat akun sebelum domain aktif.",
              "**Hanya mesin ini**: `http://localhost:3000`, untuk mencoba di komputermu sendiri.",
            ],
          },
          "Di Tailscale, server keluar dari jaringanmu saat kuncinya kedaluwarsa, setelah 180 hari. Agar tetap ada, buka menu **⋯** server di https://console.tailscale.com/admin/machines dan pilih **Disable Key Expiry**.",
          "Webhook yang memulai rutinitas, dan aplikasi AI yang memanggil dari server mereka sendiri, butuh alamat publik. Di Tailscale, Funnel membuka alamat yang sama ke internet: tambahkan Funnel ke kebijakan tailnet-mu di https://console.tailscale.com/admin/acls dan atur `TAILSCALE_FUNNEL=true` di `.env`, lalu jalankan `docker compose up -d`.",
        ],
      },
      {
        id: "owner",
        heading: "Akunmu",
        blocks: [
          "Buka alamat servermu dan daftar: akun pertama menjadi pemilik. Setelah itu pendaftaran ditutup, dan orang masuk lewat undangan, dari **Pengaturan\u00a0›\u00a0Anggota dan undangan**.",
          "Di Tailscale, orang yang kamu undang juga perlu masuk ke tailnet-mu. Undang mereka dulu di https://console.tailscale.com/admin/users lalu di agentes.chat.",
        ],
      },
      {
        id: "email",
        heading: "Email",
        blocks: [
          "Tanpa email, agentes.chat menulis setiap email ke log-nya alih-alih mengirimnya, jadi tautan undangan tetap bisa disalin dari sana. Atur ulang kata sandi tetap mati.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "Penyiapan menerima server email milikmu sendiri (SMTP) atau kunci API yang kompatibel dengan Resend, seperti MillionSend atau Resend. Email dikirim dari `ping@` domain servermu kecuali kamu memilih pengirim lain, dan domain itu harus terverifikasi di penyedia emailmu. Untuk menyiapkannya nanti, jalankan pemasangan lagi.",
        ],
      },
      {
        id: "phone",
        heading: "Ponselmu",
        blocks: [
          {
            list: [
              "Di Tailscale, pasang aplikasi Tailscale di ponselmu dan masuk ke tailnet yang sama.",
              "Pasang aplikasi agentes.chat.",
              "Pindai kode QR yang ditampilkan penyiapan, atau yang ada di **Pengaturan\u00a0›\u00a0Akunmu\u00a0›\u00a0Buka di ponselmu**, yang juga langsung memasukkanmu.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "Komputer agen-agenmu",
        blocks: [
          "Penyiapan bisa menjadikan server ini juga komputer agenmu, tempat mereka menjalankan perintah, memakai browser, dan menyimpan file. Ia bertanya, dan menyarankan ya kalau server sanggup. Di Debian 13, setiap agen mendapat pengguna sendiri, dengan layar. Di Ubuntu, agen berbagi satu pengguna, `agentes`. Kalau kamu menjawab tidak, jalankan pemasangan lagi dengan `--computer yes`:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "Komputer lain, seperti Mac dengan aplikasi agentes.chat atau server lain, terhubung dari **Pengaturan\u00a0›\u00a0Perangkat**, seperti di [Komputer dan ponselmu](/help/computers). Di Tailscale, komputer itu masuk ke tailnet-mu lebih dulu.",
        ],
      },
      {
        id: "backups",
        heading: "Cadangan dan pemulihan",
        blocks: [
          "Servermu terdiri dari tiga hal: database, file yang diunggah, dan `AGENTES_SECRET` di `.env`. Simpan salinan `.env` di tempat aman, terpisah dari cadangan: tanpa rahasia itu, kunci yang tersimpan di database yang dipulihkan tidak bisa dibaca.",
          "Untuk cadangan setiap hari, buat bucket privat di Cloudflare R2 atau penyimpanan lain yang kompatibel dengan S3, dan kunci yang bisa membaca, menulis, dan menghapus di sana. Tambahkan ke `.env`, dengan `backup` di `COMPOSE_PROFILES` (`https,backup` dengan domain publik):",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "Lalu jalankan `docker compose up -d` di folder pemasangan. Database dicadangkan pukul 03:00 UTC dan setiap cadangan disimpan 14 hari. `docker compose run --rm backup now` membuat satu saat itu juga, dan `docker compose run --rm backup list` menampilkan daftarnya. Cadangan hanya berisi database: file yang diunggah, di volume `files`, perlu salinan sendiri, dan panduan lengkap di bawah punya perintahnya.",
          "Untuk memulihkan, ambil cadangan dengan `docker compose run --rm -T backup fetch <nama> > agentes.dump`, lalu muat ke database kosong saat aplikasi berhenti:",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "Pulihkan ke versi yang membuat cadangan itu, atau versi yang lebih baru.",
        ],
      },
      {
        id: "upgrades",
        heading: "Pembaruan",
        blocks: [
          "Di folder pemasangan, jalankan:",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "Database memperbarui dirinya sendiri saat versi baru menyala. Simpan pengaturanmu di `.env` dan jangan pernah mengubah `docker-compose.yml`, karena setiap pembaruan menggantinya. Buat cadangan sebelum lompatan besar: database yang diperbarui versi lebih baru tidak bisa dibuka di versi lebih lama.",
        ],
      },
      {
        id: "data",
        heading: "Yang dikirim",
        blocks: [
          "Sekali sehari server mengirim statistik pemakaian anonim ke agentes.chat: hitungan seperti jumlah orang, agen, ukuran mesin, token AI yang dipakai, dan berapa banyak data yang dikirim dan diterima browser para agen. Tidak pernah pesan, file, nama, atau situs. `docker compose run --rm agentes telemetry` menampilkan persis apa yang akan dikirim. Pemilik mematikannya di **Pengaturan\u00a0›\u00a0Umum**, atau dengan `TELEMETRY=off` di `.env`.",
          "Laporan galat tidak dikirim ke mana pun kecuali kamu mengatur `SENTRY_DSN` ke server yang kompatibel dengan Sentry pilihanmu. Laporan berisi galat dan tempat terjadinya, tidak pernah pesan, email, alamat IP, cookie, atau token.",
        ],
      },
      {
        id: "reference",
        heading: "Panduan lengkap",
        blocks: [
          "Semua pengaturan, proxy milikmu sendiri seperti nginx, menjalankan tanpa Docker, langkah-langkah untuk agen AI yang memasangnya sendiri, dan apa yang dilakukan saat ada yang gagal ada di `SELF_HOSTING.md`, di repositori agentes.chat.",
        ],
      },
    ],
  },
};
