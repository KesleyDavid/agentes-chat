import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

/** The help pages in tr: a page not here shows in English. */
export const helpTr: Partial<Record<HelpSlug, HelpDocument>> = {
  "run-on-your-computer": {
    title: "agentes.chat'i kendi bilgisayarınızda çalıştırın",
    summary:
      "agentes.chat uygulaması, agentes.chat'in kendisini de bir Mac, PC ya da Linux bilgisayarda, sizin ya da küçük bir ekip için çalıştırabilir.",
    sections: [
      {
        id: "how",
        heading: "Nasıl çalışır",
        blocks: [
          "Uygulamanın içinde, kendi yerleşik veritabanıyla çalışır ve her şeyi bu bilgisayardaki tek bir klasörde, ana klasörünüzdeki `.agentes` içinde tutar. Başka hiçbir şey kurmanız gerekmez: Docker yok, kurulacak bir veritabanı yok.",
          "Uygulamayla birlikte başlar ve uygulamadan çıktığınızda durur. Çıkmadan önce uygulama sorar, çünkü uygulama yeniden açılana kadar kimse agentes.chat'i kullanamaz.",
        ],
      },
      {
        id: "who",
        heading: "Kimin için",
        blocks: [
          "Siz ya da küçük bir ekip. Açık kalan bir Mac mini, yedek bir PC ya da dizüstü bilgisayar iyi bir yuva olur: onu [Açık tutun](#keep-on) bölümündeki gibi ayarlayın. Bir Mac'te ya da PC'de agentes.chat'i Docker olmadan çalıştırmanın yolu uygulamadır.",
          "Daha büyük bir ekip için [Hangi kurulumu seçmeli](/help/install-on-a-server#choose) sayfasına bakın. Verilerinizi sonra bir sunucuya taşıyabilirsiniz.",
        ],
      },
      {
        id: "keep-on",
        heading: "Açık tutun",
        blocks: [
          "Başkalarının da kullandığı bir bilgisayarda bunu bir kez ayarlayın:",
          {
            list: [
              "**Oturum açılınca başlat** kurulumdan sonra kendiliğinden açılır.",
              "Mac'te **Sistem Ayarları\u00a0›\u00a0Kullanıcılar ve Gruplar** içinde **Otomatik oturum açma** seçeneğini açın, böylece uygulama yeniden başlatmadan sonra açılır. FileVault otomatik oturum açmayı kapatır.",
              "Mac'te **Sistem Ayarları\u00a0›\u00a0Enerji** içinde **Elektrik kesintisinden sonra otomatik olarak başlat** seçeneğini açın.",
              "Sunucu çalışırken ve **Telefonunuzdan ve ekip arkadaşlarınızdan erişin** açıkken Mac uyku moduna geçmez. Windows ve Linux'ta uykuyu sistemin güç ayarlarından kapatın.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "Ajanlarınız da burada çalışır",
        blocks: [
          "Ajanlarınız da bu bilgisayarda, kendi klasörlerinde, bir tarayıcıyla ve burada kuruluysa Claude Code ya da Codex ile çalışır.",
          "Buradaki ajanlar sizin adınıza çalışır. **Komutlar** varsayılan olarak açıktır. Açıkken bu bilgisayarı kullanan her çalışma alanının ajanları, sunucunun verileri dahil, bu bilgisayardaki her şeye ulaşabilir. Onları **Tercihler\u00a0›\u00a0Araçlar** içinde kapatabilirsiniz. [Ajanlar nelere ulaşabilir](/help/computers#reach) bölümüne bakın.",
        ],
      },
      {
        id: "another-workspace",
        heading: "Başka bir çalışma alanına da açın",
        blocks: [
          "Burada çalıştırdığınız sunucunun çalışma alanları bu bilgisayarı kendiliğinden kullanır. Başka bir yerdeki bir çalışma alanının da, örneğin agentes.chat Cloud'daki birinin, kullanmasını istiyorsanız **Tercihler\u00a0›\u00a0Sunucular** bölümünü açın, **Sunucu ekle…** düğmesine basın, o çalışma alanında oturum açın ve uygulama sorduğunda **İzin ver** düğmesine basın.",
          "Her çalışma alanının burada kendi ajanları ve klasörleri olur. **Komutlar** onun için de varsayılan olarak açıktır. Onları uygulamanın sorusunda **İzin ver**'e basmadan önce ya da daha sonra **Tercihler\u00a0›\u00a0Araçlar** içinde kapatın. Oradaki tek anahtar bu bilgisayardaki tüm çalışma alanları için geçerlidir.",
        ],
      },
      {
        id: "reach",
        heading: "Telefonunuzdan ve ekibinizden erişim",
        blocks: [
          "**Telefonunuzdan ve ekip arkadaşlarınızdan erişin**, agentes.chat'i cihazlarınız için özel bir ağ olan Tailscale'e koyar: telefonunuz ve davet ettiğiniz kişiler bu ağa katılır, başka hiç kimse agentes.chat'e ulaşamaz. Tailscale ücretsizdir: https://tailscale.com/download. Bu seçenek kapalıyken agentes.chat yalnızca bu bilgisayarda çalışır.",
          "Bu bilgisayar Tailscale'in 443 portunda zaten başka bir şey paylaşıyorsa agentes.chat 8443 portunu kullanır ve adresi `:8443` ile biter.",
        ],
      },
      {
        id: "password",
        heading: "Diğer cihazlardan giriş",
        blocks: [
          "Sahibin başta bir şifresi yoktur: uygulama bu bilgisayarda sizin yerinize oturum açar. Başka bir bilgisayardaki tarayıcıdan giriş yapmak için **Ayarlar\u00a0›\u00a0Hesabınız** bölümünden bir şifre ekleyin. Telefon uygulaması, **Tercihler\u00a0›\u00a0Sunucular** içindeki **Telefonunuzda** altında bulunan QR kodunu tarayarak bağlanır. Bunun için **Telefonunuzdan ve ekip arkadaşlarınızdan erişin** açık olmalıdır.",
        ],
      },
      {
        id: "updates",
        heading: "Güncellemeler",
        blocks: [
          "Uygulama güncellemeleri kendisi arar ve **Tercihler\u00a0›\u00a0Güncellemeler** içinde **Güncelle ve yeniden aç** düğmesine bastığınızda yükler. Sunucu ve tüm ajanlar onunla birlikte yeniden başlar. Önce veritabanı kopyalanır ve yeni sürüm 3 dakika içinde yanıt vermezse uygulama kendiliğinden önceki sürüme ve onun verilerine geri döner.",
        ],
      },
      {
        id: "backups",
        heading: "Yedekler",
        blocks: [
          "Henüz hiçbir şey kendiliğinden yedeklenmiyor. **Tercihler\u00a0›\u00a0Sunucular** içindeki **Şimdi yedekle**, sunucuyu kısa bir süre durdurur ve veritabanını, dosyaları ve `.env` dosyasını ana klasörünüzdeki `.agentes/backups` içine kaydeder. En yeni iki yedeği tutar.",
          "Bunları ara sıra bu bilgisayarın dışına, bir diske ya da bir bulut depolama alanına kopyalayın. İçlerinde anahtarlarınız var: onları gizli tutun.",
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code ve Codex",
        blocks: [
          "Uygulama Claude Code ve Codex'i oturum açma kabuğunuzun `PATH` değişkeniyle ve `~/.local/bin`, `/opt/homebrew/bin` ve `/usr/local/bin` gibi alışılmış klasörlerde arar. **Tercihler\u00a0›\u00a0Araçlar** **Bulunamadı** diyorsa `claude` ya da `codex` komutunun yeni bir Terminal penceresinde çalıştığını kontrol edin, sonra uygulamadan çıkıp yeniden açın.",
        ],
      },
      {
        id: "moving",
        heading: "Bir sunucuya taşıma",
        blocks: [
          {
            list: ["Uygulamadan çıkın, sonra veritabanının dökümünü uygulamanın kendi sunucu kopyasıyla alın. Mac'te:"],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[agentes.chat'i bir sunucuya kurun](/help/install-on-a-server), ama henüz başlatmayın. Onun `.env` dosyasına `~/.agentes/.env` içindeki `AGENTES_SECRET` değerini yazın, sonra yalnızca veritabanını başlatın: `docker compose up -d postgres`.",
              "Dökümü yükleyin: `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "`docker compose up -d` ile başlatın, `~/.agentes/files` klasörünü tam kılavuzda gösterildiği gibi içine kopyalayın ve eskisi gibi giriş yapın.",
            ],
          },
        ],
      },
    ],
  },
  computers: {
    title: "Bilgisayarlarınız ve telefonlarınız",
    summary:
      "Bir Mac, PC, Linux bilgisayar, sunucu ya da telefon getirin, ajanlarınız onun üzerinde çalışsın. Hem agentes.chat Cloud'da hem kendi sunucunuzda.",
    sections: [
      {
        id: "app",
        heading: "agentes.chat uygulamasından",
        blocks: [
          "Uygulamayı bilgisayara kurun, açın ve çalışma alanınızda oturum açın. Uygulama **<workspace> ajanları bu Mac cihazını kullanabilsin mi?** diye sorar (Windows'ta bu PC, Linux'ta bu bilgisayar). Kimlerin kullanabileceğini seçin ve **İzin ver** düğmesine basın. Hepsi bu.",
          "Zaten oturum açtınız mı? Çalışma alanını **Tercihler\u00a0›\u00a0Genel** içindeki **Ajanlar** kartında açın.",
        ],
      },
      {
        id: "web",
        heading: "Web sitesinden",
        blocks: [
          "**Ayarlar\u00a0›\u00a0Cihazlar** bölümünde **Cihaz bağla** düğmesine basın:",
          {
            list: [
              "**Bu Mac** ya da **Bu PC**: uygulamayı açar, uygulama önce size sorar.",
              "**Başka bir bilgisayar**: uygulamayı oraya kurun, kendi hesabınızla oturum açın ve **İzin ver** düğmesine basın. Bilgisayar burada kendiliğinden görünür.",
              "**Bir sunucu ya da VPS**: terminalinde tek bir satır çalıştırın, sonra katılmasına izin verin. Satır yalnızca bir kez ve 10 dakika boyunca çalışır.",
            ],
          },
          "Uygulama tek tıkla yalnızca https kullanan bir adrese bağlanır, örneğin `.ts.net` ile biten bir Tailscale adresine. Düz bir http adresinde terminal satırını kullanın.",
        ],
      },
      {
        id: "phones",
        heading: "Telefonlar",
        blocks: [
          "Bir Android telefon, zaten bağlı herhangi bir bilgisayar üzerinden bağlanır: kabloyla ya da Mayıs 2026 güvenlik güncellemesi yüklü Android 14 ve sonrasında Wi-Fi ile. Bir iPhone, uygulama ve Xcode kurulu bir Mac üzerinden bağlanır, gerisini uygulama hazırlar. İkisi de **Cihaz bağla** ile başlar.",
        ],
      },
      {
        id: "who",
        heading: "Kimler kullanabilir",
        blocks: [
          "Yeni bir cihaz yalnızca sizindir: **Yalnızca ben**, siz ve sizin için çalışan ajanlar demektir. İzin verirken ya da daha sonra **Ayarlar\u00a0›\u00a0Cihazlar** içindeki sayfasından onu çalışma alanındaki herkese ya da bazı kişilere ve rollere açın.",
        ],
      },
      {
        id: "open",
        heading: "Uygulama açıkken",
        blocks: [
          "Ajanlar bir bilgisayarda yalnızca uygulama orada çalışırken ve bilgisayar uyanıkken çalışır. Uygulama sorduğunda **Hazır tut: oturum açılınca agentes.chat'i başlat** işaretli kalsın. Kapalı ya da uykudaki bir bilgisayar **Çevrimdışı** görünür ve ajanlar onun geri gelmesini bekler.",
        ],
      },
      {
        id: "pausing",
        heading: "Duraklatma ve bağlantıyı kesme",
        blocks: [
          "Bilgisayarda, saatin yanındaki agentes.chat simgesi tüm çalışma alanlarının ajanlarını duraklatır. **Tercihler\u00a0›\u00a0Genel** içinde her çalışma alanının anahtarı yalnızca onu duraklatır, **Ayrıl** ise bağlantısını keser. Duraklatılmışken yeni hiçbir şey başlamaz ve çalışmakta olanlar tamamlanır. Bağlantıyı kesmek ajanların klasörlerini diskte bırakır.",
          "Web sitesinden, cihazın sayfasındaki **Kaldır** onun bağlantısını keser.",
        ],
      },
      {
        id: "organizations",
        heading: "Birden çok çalışma alanı, tek bilgisayar",
        blocks: [
          "Aynı uygulamada her çalışma alanında oturum açın ve her biri için **İzin ver** düğmesine basın. agentes.chat Cloud'daki ve kendi sunucularınızdaki çalışma alanları aynı bilgisayarı paylaşabilir (uygulama 0.6.1 ve sonrası). Her birinin orada kendi ajanları ve klasörleri olur ve birinin bağlantısını kesmek diğerlerini etkilemez.",
          "Uygulamanın bu bilgisayarda çalıştırdığı bir sunucu zaten bağlıdır ve hiçbir şey gerektirmez. Bu bilgisayarı başka bir yerdeki bir çalışma alanına da açmak için [Başka bir çalışma alanına da açın](/help/run-on-your-computer#another-workspace) bölümüne bakın.",
          "Uygulamayı bir dizüstünde yalnızca çalışma alanınıza açılan bir pencere olarak mı kullanıyorsunuz? Ajanların dizüstünü kullanması için izin istediğinde **Şimdi değil** derseniz uygulama sade bir pencere olarak kalır.",
        ],
      },
      {
        id: "folders",
        heading: "Klasörler",
        blocks: [
          "Her ajanın `~/agentes/<workspace>` içinde her zaman kendi klasörü vardır. Başka klasörlere izin bilgisayarın kendisinden verilir, asla web sitesinden verilmez: uygulamada **Tercihler › Klasörler** bölümünden, bir sunucudaysa `agentes-runner folders allow` ile. Her çalışma alanı kendi klasörlerine izin verir: birine verdiğiniz izin yalnızca onun ajanları için geçerlidir. Bir klasörü kaldırmak hiçbir şeyi silmez. Yalnızca erişimi kaldırır.",
        ],
      },
      {
        id: "reach",
        heading: "Ajanlar nelere ulaşabilir",
        blocks: [
          "Ajanlar sizin adınıza, bilgisayarın kullanıcısı olarak çalışır. Dosya araçları kendi klasörlerinde kalır, ama bir komut sizin okuyabildiğiniz her şeyi okuyabilir:",
          {
            list: [
              "dosyalarınız ve oturumlarınız",
              "diğer ajanların klasörleri, başka çalışma alanlarınınkiler dahil, ve tarayıcılarının sakladığı oturumlar",
              "bu bilgisayarı bağlayan jeton",
              "agentes.chat'i de çalıştıran bir bilgisayarda, onun `.agentes` içindeki veritabanı ve anahtarları",
            ],
          },
          "agentes.chat anahtarların, token'ların ve oturum bilgilerinin adını geçiren komutları reddeder, ama bu bir kuraldır, duvar değil. **Komutlar** varsayılan olarak açıktır. Onları uygulamanın sorusunda **İzin ver**'e basmadan önce ya da daha sonra **Tercihler\u00a0›\u00a0Araçlar** içinde kapatın. Oradaki tek anahtar bilgisayardaki tüm çalışma alanları için geçerlidir. Claude Code ve Codex kendi komutlarını ajanın klasöründe, kendi kurallarıyla çalıştırır.",
          "Gerçek bir duvar için bir Linux sunucu kullanın. Debian 13'te `--system` ile kurulduğunda her ajan ayrı bir kullanıcıdır. Ubuntu'da ajanlar tek bir kullanıcıyı, `agentes` kullanıcısını paylaşır: birbirlerinin klasörlerini görürler, sizinkileri ya da sunucununkileri görmezler. Ya da ajanlara kendilerine ait bir bilgisayar verin.",
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "Çalışma alanının bilgisayarı",
    summary: "Her çalışma alanına, ajanlarının çalıştığı, hep açık kendi bilgisayarı verilir.",
    sections: [
      {
        id: "what",
        heading: "Nedir",
        blocks: [
          "Yalnızca bu çalışma alanına ait, hep açık bir bilgisayar. Her ajanın üzerinde kendi klasörü, ekranı, tarayıcısı ve dosyaları olan ayrı bir kullanıcısı vardır. Bir ajanın sayfasından onun çalışmasını izleyebilir, gerektiğinde kontrolü alabilirsiniz.",
        ],
      },
      {
        id: "own",
        heading: "Kendi bilgisayarlarınız ve telefonlarınız",
        blocks: [
          "Ajanlar getirdiğiniz bilgisayarlarda ve telefonlarda da çalışabilir: agentes.chat uygulamalı bir Mac ya da PC, bir sunucu, bir Android telefon ya da bir iPhone. [Getirdiğiniz bilgisayarlar ve telefonlar](/help/computers) sayfasına bakın.",
        ],
      },
      {
        id: "plans",
        heading: "Yapay zeka planlarınız",
        blocks: [
          "Ajanlarınız, bu bilgisayarda giriş yapılmış Claude, ChatGPT, GLM ya da Kimi gibi kendi yapay zeka planınızla düşünebilir: API anahtarı gerekmez. Hesap bu bilgisayarda kalır ve agentes.chat şifreyi ya da erişimi asla görmez.",
          "Google'ın AI Pro ve Ultra planları burada çalışmaz: Google'ın koşulları başka ürünlerde kullanılmalarına izin vermez. Bir Gemini API anahtarı ise çalışır.",
        ],
      },
      {
        id: "size",
        heading: "Boyutu",
        blocks: ["İşlemcileri, belleği ve diski **Ayarlar\u00a0›\u00a0Cihazlar** bölümünde görünür."],
      },
      {
        id: "trouble",
        heading: "Yanıt vermeyi bırakırsa",
        blocks: [
          "Genellikle birkaç dakika içinde geri gelir ve biz ilgileniyoruz: sizin yapmanız gereken bir şey yok.",
        ],
      },
    ],
  },
  import: {
    title: "Ajanlarınızı getirin",
    summary:
      "Ajanları başka bir uygulamadan ya da başka bir agentes.chat çalışma alanından talimatları, becerileri, rutinleri ve bellekleriyle birlikte getirin.",
    sections: [
      {
        id: "comes",
        heading: "Neler gelir",
        blocks: [
          {
            list: [
              "Ajanlar, adları, rolleri, talimatları ve görünümleriyle.",
              "Beceriler, onlara sahip olan ajanlar için açık olarak.",
              "Herkese açık kanallar, içlerindeki ajanlarla.",
              "Rutinler, etkin ve kendi zamanlamalarıyla. İsterseniz **Rutinler** bölümünden duraklatın.",
              "Bellek: her ajanın hatırladıkları.",
              "Her ajanın kendi dosyaları (OpenBot.run'ın dosya klasörü, bir OpenClaw çalışma alanı), **Drive** içinde ajanın adını taşıyan bir klasörde. Anahtarlar, oturum bilgileri ve sistem dosyaları geride kalır ve orada zaten olan hiçbir şeyin yerine yenisi konmaz.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "Asla gelmeyenler",
        blocks: [
          "Anahtarlar, şifreler, oturum bilgileri ve sohbet geçmişi asla gelmez: ajanlar çalışma alanının yapay zekasıyla düşünür. Bazı şeylerin burada henüz karşılığı yok ya da bir dosyada hiç taşınmamalı. Bunları sonra yeniden oluşturabilirsiniz.",
          "Dosyalar ve klasörler tarayıcınızda okunur. Bir GitHub bağlantısı çalışma alanının sunucusundan geçer. Anahtar ve oturum dosyaları asla açılmaz ve siz onaylayana kadar hiçbir şey değişmez.",
        ],
      },
      {
        id: "other-apps",
        heading: "Başka bir uygulamadan",
        blocks: [
          "**Grok Bot**, **ChatGPT dots** ya da **Başka bir uygulama** seçeneğini seçin. İsteği kopyalayıp o uygulamaya yapıştırın, sonra döndürdüğünü geri getirin: dosyayı sürükleyip bırakın ya da yanıtın tamamını yapıştırın. Her uygulamada nereye yapıştırılır:",
          {
            list: [
              "**Grok Bot**: botunuzla olan sohbete. JSON ile yanıt verir: yanıtın tamamını kopyalayın.",
              "**ChatGPT dots**: yeni bir sohbete. Oluşturduğu dosyayı indirin.",
              "**Claude**: yeni bir sohbete ya da ajanlarınızın projesine. Oluşturduğu dosyayı indirin.",
              "**Manus**: yeni bir göreve. Dosya, görevin sonuçlarında.",
              "**Rakazo**: ajanınıza gönderin. JSON ile yanıt verir: yanıtın tamamını kopyalayın.",
              "**OpenBot**: istek gerekmez. Tenant klasörünü (agents.yaml, agents/, model.yaml, skills.yaml) sürükleyin ya da GitHub bağlantısını yapıştırın.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "Bir çalışma alanını dışa aktarın",
        blocks: [
          "**Ayarlar › İçe ve dışa aktar › Dışa aktar**, ajanlarınızı başka bir çalışma alanına götürmek ya da bir kopyasını saklamak için bir .json dosyası indirir. Dosyada şunlar var:",
          {
            list: [
              "Ajanlar, talimatları, modelleri ve görünümleriyle",
              "Beceriler, SKILL.md dosyasının tamamıyla",
              "Herkese açık kanallar, ajanlarıyla",
              "Zamanlanmış rutinler (diğer tarafa etkin olarak gelir)",
              "Çalışma alanındaki herkesin görebildiği bellek",
            ],
          },
          "Dosyada asla olmayanlar:",
          {
            list: [
              "API anahtarları ve şifreler",
              "Bağlayıcılar ve oturum bilgileri",
              "Bilgisayarlar",
              "Sohbetler, mesajlar ve özel kanallar",
              "Kullanım, maliyetler ve etkinlik geçmişi",
            ],
          },
          "Dosyayı kullanmak için diğer çalışma alanında **Ayarlar › İçe ve dışa aktar** bölümünü açın ve .json dosyasını bırakın.",
        ],
      },
    ],
  },
  wiki: {
    title: "Wiki",
    summary: "Şirketin bildikleri, birbirine bağlı sayfalarda.",
    sections: [
      {
        id: "links",
        heading: "Bağlantılar",
        blocks: [
          "Başka bir sayfaya bağlantı vermek için [[ yazın. Geri bağlantılar ve grafik, sayfaların birbirine nasıl bağlandığını gösterir.",
        ],
      },
      {
        id: "agents",
        heading: "Ajanlar nasıl kullanır",
        blocks: ["Ajanlar yanıt verirken wiki'yi okur. Wiki'ye yalnızca biri istediğinde yazarlar."],
      },
      {
        id: "obsidian",
        heading: "Bir Obsidian kasası getirin",
        blocks: [
          "Kasanın klasörünü ya da onun .zip dosyasını kurulumun Bağlam adımına veya wiki'nin kendi içe aktarma bölümüne bırakın. [[Bağlantılar]], [[not|takma ad]] ve [[not#bölüm]] çalışmaya devam eder. Etiketler frontmatter'dan ve metinden gelir. Ekler Drive'a gider, gömülü görseller ve dosyalar sayfada kartlara dönüşür. Uyarı kutuları uyarı kutusu olarak kalır. Dataview sorguları metin olarak gelir: tabloyu bir ajandan oluşturmasını isteyin. Canvas dosyaları ve Obsidian ayarları (.obsidian) dışarıda kalır.",
        ],
      },
    ],
  },
  memory: {
    title: "Bellek",
    summary: "Her ajanın sohbetlerden ve ekibin düzeltmelerinden öğrendikleri.",
    sections: [
      {
        id: "learns",
        heading: "Ajanlar nasıl öğrenir",
        blocks: [
          "Ajanlar sohbetlerden ve ekibin düzeltmelerinden öğrenir. Bir ajanın bildiği şey, ilgili olduğunda bağlamına girer. **Bellek** sekmesinde yanlış ya da eskimiş olanı düzenleyin, sabitleyin veya arşivleyin.",
        ],
      },
      {
        id: "permissions",
        heading: "Bellek izin vermez",
        blocks: [
          "Bellekteki hiçbir şey bir ajanın daha fazlasını yapmasına izin vermez. Neler yapabileceği **Araçlar ve erişim** bölümünde kalır ve hassas işlemler her zaman onay ister.",
        ],
      },
      {
        id: "proposals",
        heading: "Önerilen değişiklikler",
        blocks: [
          "Bir ders tekrarlandığında ajan kendi talimatlarını ya da çalışma alanının bağlamını değiştirmeyi önerebilir. Biri kabul edene kadar hiçbir şey değişmez ve metin önce düzenlenebilir. Önceki sürüm geçmişte kalır. Reddedilen bir öneri ders olarak saklanır, böylece tekrar önerilmez.",
        ],
      },
    ],
  },
  approvals: {
    title: "Onaylar",
    summary: "Hassas işlemler bir kişiyi bekler, bir kez ya da kalıcı olarak.",
    sections: [
      {
        id: "what",
        heading: "Neler önce sorar",
        blocks: [
          "Bir ajan merge, deploy ya da geri alma yapmak, dışarıya bir şey göndermek veya veri silmek istediğinde, erişimi ne olursa olsun önce sorar. İstek, tam işlem ve nedeniyle birlikte **Onaylar** bölümünde ve konuşmada görünür.",
        ],
      },
      {
        id: "always",
        heading: "Bir kez ya da her zaman",
        blocks: [
          "Onaylamak, değerleriyle birlikte tek bir işlemi kapsar. Ajan herhangi bir şeyi değiştirirse yeniden sorar.",
          "**Her zaman onayla**, ajanın bu tür bir işlemi bundan sonra her değerle, sormadan yapmasına izin verir. Bir rutinin isteğinde **Bu rutinde her zaman** aynısını yalnızca o rutin için yapar. İkisi de merge, deploy, geri alma ve benzerleri için sunulmaz. Geri almak için ajanın sayfasındaki **Araçlar ve erişim** bölümüne ya da rutinin ayarlarına gidin.",
        ],
      },
      {
        id: "who",
        heading: "Kim onaylar",
        blocks: [
          {
            list: [
              "Ajanın sahibi, ajanın istekleri için.",
              "Rolünde **Ajanların eylemlerini onaylama** olan herkes, tüm ajanlar için.",
              "Ajanın isterken adını verdiği kişiler, sahibinin yerine.",
              "**Benim yerime kim onaylar** bölümünde birinin yerine bakan kişi, o kişiden istenenler için. Merge, deploy ve diğer riskli işlemler yalnızca bu açıksa.",
            ],
          },
          "Birinin kendi posta kutusundaki bir işlem yalnızca o kişiyi bekler. Bir ajan için yeni erişim, ajanları yönetenleri bekler.",
          "Sağ kolunuz Lodi de diğer ajanların önerdiği yeni ajanları ve bir ajanın modeli, bütçesi ve kanallarındaki değişiklikleri, yalnızca siz istediyseniz, sizin yerinize onaylayabilir. Kimin sizin yerinize baktığını ve Lodi’nin neyi onaylayacağını **Ayarlar\u00a0›\u00a0Siz\u00a0›\u00a0Onaylar** bölümünden seçersiniz.",
        ],
      },
      {
        id: "refusing",
        heading: "Reddetmek",
        blocks: ["İsterseniz nedenini söyleyin: ajan bunu okur, planını ayarlar ve ders olarak saklar."],
      },
      {
        id: "meetings",
        heading: "Toplantılar",
        blocks: ["Ajanlar yalnızca saat önerir. Kişilere davetler her zaman isteyen kişi üzerinden gider."],
      },
    ],
  },
  "who-answers": {
    title: "Bir mesajı kim yanıtlar",
    summary: "Bir bahsetme ajanı seçer. Bahsetme yoksa agentes.chat sizin için bu sırayla seçer.",
    sections: [
      {
        id: "order",
        heading: "Bir mesaj ajanını nasıl bulur",
        blocks: [
          "Bir ajandan @ ile bahseden mesaj o ajana gider. Kimseden bahsetmeyen bir mesajı, çalışma alanında olanlar arasında bu listedeki ilki okur:",
          {
            list: [
              "**Jev**, bu tür kararlar için yapılmış küçük ve hızlı bir model.",
              "**Çalışma alanının API anahtarlarından birindeki küçük bir model**, örneğin Claude Haiku 5.5 ya da GPT-6 Luna.",
              "**Kendi Claude ya da ChatGPT planınız**, kendi çalıştırdığınız bir sunucuda yazdığınız mesajlar için. Mesajları giriş yapılmış olduğu bilgisayarda okur ve birkaç saniye sürer.",
              "**Basit kurallar**: bir ajana verilen yanıt o ajana gider, onunla konuştuktan hemen sonra yazdığınız devam mesajı da, tek bir ajanla yalnız olduğunuz bir kanaldaki mesaj da.",
            ],
          },
          "Bunların hiçbiri uymazsa hiçbir ajan yanıt vermez. Bir ajanı çağırmak için ondan bahsedin.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "Çalışma alanınızı agentes.chat barındırıyorsa Jev dahildir. Kendi çalıştırdığınız bir sunucuda sahibin TypeSafe anahtarını kullanır, mesaj başına yaklaşık US$ 0,0001: [Jev'i kurun](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "Planınız neden yalnızca sizin mesajlarınız için seçer",
        blocks: [
          "Claude ve ChatGPT planları kişiseldir, bu yüzden planınız yalnızca sizin yazdığınız mesajlar için seçim yapar.",
        ],
      },
      {
        id: "see",
        heading: "Kimin seçtiğini görmek",
        blocks: ["Bir mesajın altındaki onay işaretini açın. Son satırı, ajanları kimin seçtiğini söyler."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "TypeSafe'in, ajanlarınız için hızlı kararlar veren hızlı modeli. Kendi sunucunuzda isteğe bağlıdır ve kendi anahtarınızla çalışır.",
    sections: [
      {
        id: "what",
        heading: "Ne yapar",
        blocks: [
          {
            list: [
              "**Kimin yanıtlayacağını seçer.** Kimseden @ ile bahsetmeyen bir mesaj, ajanlarınız bir planla düşünse ve hiç API anahtarınız olmasa bile bir saniyeden kısa sürede doğru ajana gider.",
              "**Belleği düzenli tutar.** Bir tekrarı ya da daha yeni bir bilgiyi başka sözcüklerle söylense bile fark eder: tekrar, ajanın bildiğiyle birleşir, daha yeni bilgi eskisinin yerini alır. Günde bir kez geri kalanı toplar.",
              "**Ekranı görür.** Ajanlar tarayıcılarında ve masaüstlerinde düğmeleri ve alanları bir tariften bulur, küçük olanlara daha yakından bakar ve bir adımın işe yaradığını ekran görüntüsünden kontrol eder.",
              "**Daha az okutur.** Her turda yalnızca ajanın büyük olasılıkla ihtiyaç duyacağı araçları yükler, böylece yapay zekanız daha az okur ve daha az tutar.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Jev olmadan",
        blocks: [
          "Her şey çalışmaya devam eder, daha yavaş ve daha az özenle.",
          {
            list: [
              "**Kim yanıtlar:** API anahtarlarınızdan birindeki küçük bir model seçer, örneğin Claude Haiku 5.5 ya da GPT-6 Luna. Anahtar yoksa her kişinin kendi Claude ya da ChatGPT planı, o kişinin yazdığı mesajlar için birkaç saniyede seçer. Bunlar da yoksa bir yanıt ya da devam mesajı yine ajanına ulaşır. Bir ajanı çağırmak için ondan bahsedin. [Ajanlar nasıl seçilir](/help/who-answers)",
              "**Bellek:** aynı sözcüklerle yapılan tekrarlar yine birleşir. Başka sözcüklerle yapılan tekrarlar ve güncellemeler ayrı kalır.",
              "**Ekran:** ajanlar ekranda gösterilen numaraları ve tam adları kullanır. Görsellerden hiçbir şey okunmaz.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "Kurulum",
        blocks: [
          {
            list: [
              "https://console.typesafe.ai adresini açın ve Google ya da e-postanızla giriş yapın. Yeni hesap da aynı şekilde açılır.",
              "Konsolda kredi ekleyin. Jev ön ödemelidir.",
              "https://console.typesafe.ai/keys adresini açın, bir anahtar oluşturun ve hemen kopyalayın.",
              "agentes.chat'te **Ayarlar › Yapay zeka ve kullanım** bölümünü açın ve anahtarı **Jev** altına yapıştırın. Onu yalnızca bu sunucuyu kuran kişi görür.",
            ],
          },
          "Docker ile çalıştırdığınız bir sunucuda anahtarı bunun yerine `.env` dosyasına `TYPESAFE_API_KEY` olarak koyabilirsiniz. Bu anahtar, Ayarlar'dakinin önüne geçer.",
        ],
      },
      {
        id: "cost",
        heading: "Ne kadar tutar",
        blocks: [
          {
            list: [
              "Jev'in okuduğu her milyon token için US$ 0,042. Yanıtları ücretsizdir. Kimin yanıtlayacağını seçmek yaklaşık 2.500 token okur, yani yaklaşık US$ 0,0001. Bir ekran görüntüsü yaklaşık 3.900 token eder.",
              "Satın aldığınız krediler 12 ay geçerlidir. Jev'in kredisi bitmesin diye konsolda otomatik yüklemeyi açın.",
              "**Ayarlar › Yapay zeka ve kullanım**, Jev'in bu ay kaç karar verdiğini ve bunların ne kadar tuttuğunu gösterir.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "Verileriniz",
        blocks: [
          "Jev'in karar vermek için okudukları:",
          {
            list: [
              "Kanalın adı ve açıklaması, mesaj ve ondan önceki birkaç mesaj",
              "Ajanlarınızın adları ve rolleri, talimatlarının başı ve kullanabildikleri araçlar",
              "Karşılaştırdığı bellek öğeleri",
              "Bir ajanın görevi ve araç sonuçlarının başı",
              "Bir misyonun hedefi ve bir ajanın bunun için çalıştırmak istediği komutlar",
              "Bağlı bir uygulamanın sunduğu araçlar",
              "Bir ajanın kullandığı sayfa ya da ekran, ekran görüntüleri dahil",
            ],
          },
          "TypeSafe, Jev'i Amerika Birleşik Devletleri'nde çalıştırır ve modellerini gönderdiklerinizle eğitmez. Verileri hizmeti sürdürmek için gerektiği kadar saklar. Kurumsal planlarında sıfır saklama seçeneği vardır.",
          "TypeSafe'in gizlilik politikası: https://typesafe.ai/legal/privacy-policy. Veri işleme sözleşmesi: https://typesafe.ai/legal/data-processing.",
        ],
      },
      {
        id: "problems",
        heading: "Durduğunda",
        blocks: [
          {
            list: [
              "**Anahtar kabul edilmedi:** yeni bir anahtar oluşturun ve **Ayarlar › Yapay zeka ve kullanım** bölümüne yapıştırın.",
              "**Kredi bitti:** konsolda kredi ekleyin. Jev 30 dakika içinde yeniden dener ya da **Tekrar kontrol et** düğmesine tıklayın.",
              "**Meşgul ya da ulaşılamıyor:** TypeSafe saniye başına istekleri sınırlayabilir ya da bir süre yanıt vermeyebilir. Jev kendiliğinden yeniden devreye girer. Limitleriniz: https://console.typesafe.ai/rate-limits. Daha yüksek limitler için sales@typesafe.ai adresine yazın.",
            ],
          },
          "Bu sırada ajanlar [Jev olmadan](/help/jev#without) bölümündeki gibi çalışır.",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "Yapay zeka uygulamaları",
    summary:
      "Claude, Cursor ya da başka bir MCP uygulamasından çıkmadan agentes.chat ajanlarına görev verin ve yanıtı orada alın.",
    sections: [
      {
        id: "what",
        heading: "Nasıl çalışır",
        blocks: [
          "agentes.chat bir MCP sunucusudur. Adresini yapay zeka uygulamanıza yapıştırır, hesabınızla giriş yapar ve bir çalışma alanı seçersiniz. Bundan sonra uygulama ajanları ve kanalları listeleyebilir, sizin adınıza bir ajana görev gönderebilir, yanıtı bekleyebilir ve son görevleri okuyabilir.",
          "Örneğin Unity ya da Blender'da bir sahnenin ortasında Claude'a şunu söyleyin: \"Pazarlama ajanından bir lansman metni iste\". Mesaj agentes.chat'te sizin mesajınız olarak, **Claude üzerinden** işaretiyle görünür ve ajanın yanıtı Claude'a geri gelir.",
          "Adres **Ayarlar › Yapay zeka uygulamaları** bölümündedir. Sonu `/mcp` ile biter.",
        ],
      },
      {
        id: "connect",
        heading: "Bir uygulama bağlayın",
        blocks: [
          {
            list: [
              "**Claude** (claude.ai, Claude Desktop ve telefon): **Customize › Connectors** içinde **+ Add**'e, ardından **Add custom connector**'a tıklayın, adını agentes.chat koyun, adresi yapıştırın ve **Continue**'ya tıklayın. **Sign in now** seçeneğini seçin, **Add**'e tıklayın ve yetki verin. Team ve Enterprise planlarında bağlayıcıyı Claude organizasyonunun Owner'ı Organization settings › Connectors içinden ekler ve her kişi Customize › Connectors içinde **Connect**'e tıklar. Claude'un ücretsiz planında bir özel bağlayıcıya yer vardır.",
              "**Claude Code:** `claude mcp add --transport http --scope user agentes <address>` komutunu çalıştırın, ardından `/mcp` yazın, agentes'i seçin ve **Authenticate**'e tıklayın. Yalnızca geçerli klasör için `--scope user` kısmını çıkarın.",
              "**Cursor:** **Ayarlar › Yapay zeka uygulamaları** içindeki **Cursor'a ekle** ya da adresi `~/.cursor/mcp.json` dosyasına ekleyin. Cursor ilk kullanımda giriş yapmanızı ister.",
              '**VS Code:** **VS Code\'a ekle** ya da adresi `"type": "http"` ile `.vscode/mcp.json` dosyasına ekleyin.',
              "**Diğer uygulamalar:** ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains ve daha fazlasının adımları, adresiniz önceden doldurulmuş olarak **Uygulama bağla** içinde.",
            ],
          },
          "Giriş yaptığınızda agentes.chat, erişimi hangi uygulamanın istediğini ve nereye döneceğini gösterir. Yalnızca bağlantıyı az önce siz başlattıysanız devam edin.",
        ],
      },
      {
        id: "tools",
        heading: "Uygulama neler yapabilir",
        blocks: [
          {
            list: [
              "`send_to_agent`: sizin adınıza bir ajana, onunla özel sohbetinizde ya da bir kanalda mesaj gönderir ve yanıtı bekler. Yalnızca **Okuma ve ajanlara görev gönderme** erişimiyle.",
              "`wait_for_reply`: bir görevin yanıtını beklemeye devam eder.",
              "`list_agents`: gördüğünüz ajanlar.",
              "`list_channels`: okuduğunuz kanallar.",
              "`read_conversation`: bir kanalın, bir ileti dizisinin ya da bir görevin son mesajları.",
              "`list_recent_tasks`: uygulamalardan gönderdiğiniz görevler ve ajanların şu anda yaptıkları.",
            ],
          },
          "Uygulama sizin adınıza hareket eder ve yalnızca sizin gördüklerinizi görür. Ajanların işlemlerini asla onaylamaz: bir ajan onay istemek için durduğunda yanıt bunu bir bağlantıyla söyler ve kararı agentes.chat'te bir kişi verir. Ayarları, üyeleri ya da izinleri de değiştirmez.",
        ],
      },
      {
        id: "workspace",
        heading: "Her bağlantıya bir çalışma alanı",
        blocks: [
          "Her bağlantı, giriş yaparken seçilen çalışma alanını kapsar. Başka bir çalışma alanını kullanmak için uygulamayı yeniden bağlayın ve diğerini seçin.",
          "**Ayarlar › Yapay zeka uygulamaları** bölümünde bağlı uygulamaları, her birinin ne zaman kullanıldığını görür ve istediğinizin bağlantısını kesebilirsiniz. Üyeleri yöneten kişiler tüm çalışma alanının uygulamalarını görür ve onların da bağlantısını kesebilir. Bir uygulamadan gönderilen her mesaj Denetim'de görünür.",
        ],
      },
      {
        id: "tokens",
        heading: "Kişisel token'lar",
        blocks: [
          "OAuth ile giriş yapamayan betikler ve uygulamalar için **Ayarlar › Yapay zeka uygulamaları** bölümünde kişisel bir token oluşturun ve `Authorization: Bearer` başlığında gönderin. Token bir kez gösterilir, yalnızca oluşturulduğu çalışma alanında çalışır ve 30 gün, 90 gün, 1 yıl sonra ya da hiç sona ermeyecek şekilde ayarlanabilir.",
          "https olmayan bir sunucuda, sunucunun kendi bilgisayarından uzaktayken kişisel bir token kullanın: OAuth ile giriş https gerektirir.",
        ],
      },
      {
        id: "limits",
        heading: "Limitler",
        blocks: [
          {
            list: [
              "Bağlantı başına dakikada en fazla 120, günde en fazla 5.000 istek.",
              "Her çalışma alanında kişi başına dakikada en fazla 20, günde en fazla 500 mesaj.",
              "Bir bekleme en fazla 45 saniye sürer. Ajan hâlâ çalışıyorsa uygulama yeniden bekler.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "Başkalarının metinleri",
        blocks: [
          "Yanıtlar, agentes.chat'teki ajanların ve kişilerin yazdığı metinleri taşır. Uygulama bu metinleri talimat olarak değil içerik olarak işaretlenmiş şekilde alır, ama bir metin yine de uygulamayı başka bir şeye ikna etmeye çalışabilir. Onaylamadan önce uygulamanızın ne yapmak üzere olduğunu kontrol edin.",
        ],
      },
      {
        id: "problems",
        heading: "Bağlanmıyorsa",
        blocks: [
          {
            list: [
              "**İsteğin süresi doldu:** giriş sayfası 30 dakika geçerlidir ve bir kez çalışır. Uygulamaya dönün ve yeniden bağlanın.",
              "**Uygulama yeniden giriş yapmanızı istiyor:** bağlantı kesildi, şifre değişti ya da çalışma alanından ayrıldınız. Uygulamadan yeniden giriş yapın.",
              "**Cursor eski bir girişte takılı kaldı:** Cursor'dan çıkın, `~/.mcp-auth` klasörünü silin ve yeniden bağlanın.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "agentes.chat'i bir sunucuya kurun",
    summary:
      "agentes.chat'i kendi sunucunuzda, ücretsiz, tüm ekibiniz için çalıştırın. Tek bir komut her şeyi hazırlar.",
    sections: [
      {
        id: "choose",
        heading: "Hangi kurulumu seçmeli",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**: her ekip için, her yerden erişilebilir. Onu biz çalıştırır, günceller ve yedekleriz. Her çalışma alanına kendi bilgisayarı verilir ve orada her ajan ayrı bir kullanıcıdır.",
              "**Uygulamayla kendi bilgisayarınız**: sizin ya da küçük bir ekip için, o bilgisayar açıkken erişilebilir. Açık kalan bir Mac mini iyi iş görür. Tek tıkla güncellenir, yedeğini elle alırsınız. Ajanlar o bilgisayarda sizin adınıza çalışır.",
              "**Bir sunucu**: daha büyük bir ekip için, her zaman açık. Üç komutla güncellenir ve her gün kendiliğinden yedek alabilir. Debian 13'te her ajan ayrı bir kullanıcıdır.",
            ],
          },
          "Bilgisayarınızdan bir sunucuya: [Bir sunucuya taşıma](/help/run-on-your-computer#moving). Hepsi [Ajanlarınızı getirin](/help/import) ile başka birinden ajan getirebilir.",
        ],
      },
      {
        id: "need",
        heading: "Gerekenler",
        blocks: [
          {
            list: [
              "64 bit Linux'lu bir sunucu ya da VPS, x64 veya arm64. Küçük bir ekip için 2 CPU, 4 GB bellek ve 20 GB disk iyi bir başlangıçtır. Bir Mac'te ya da PC'de [agentes.chat'i uygulama çalıştırır](/help/run-on-your-computer), Docker gerekmez.",
              "Compose ile Docker. Linux'ta eksikse kurulum programı önce sorar, sonra kurar.",
              "Bir erişim yolu: ücretsiz bir Tailscale hesabı (varsayılan, özel, alan adı ve açık port gerekmez) ya da sunucuyu gösteren bir alan adı ve açık 80 ile 443 portları.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "Kurun",
        blocks: [
          "Sunucuda şunu çalıştırın:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "Eksikleri kurar, sonra birkaç soru sorar: insanların nasıl erişeceği, e-posta, bu sunucunun ajanlarınızın bilgisayarı da olup olmayacağı ve anonim kullanım istatistikleri gönderip göndermeyeceği. Önerilen cevap için Enter'a basın. `/opt/agentes` içine kurulur (Docker'ı zaten kullanabilen bir kullanıcı için `~/agentes`) ve ilk seferde yaklaşık 2 GB indirir.",
          "Sonunda sunucunuzun adresini ve telefonunuz için bir QR kodu gösterir. Tekrar çalıştırmak güvenlidir: ayarlarınızı korur ve yalnızca eksik olanı tamamlar.",
          "Node.js 18 veya daha yenisi varsa, boş bir klasörde `npx @agenteschat/setup` aynı kurulumdur. Node yoksa uygulamanın imajından, geçerli klasörde çalışır ve gerisini başlatan komutlarla biter:",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "İnsanlar nasıl erişir",
        blocks: [
          {
            list: [
              "**Tailscale**, varsayılan: `https://agentes.<tailnetiniz>.ts.net` adresinde özel HTTPS, yalnızca Tailscale ağınızdaki cihazlar için. Kurmadan önce https://console.tailscale.com/admin/dns sayfasında MagicDNS ve HTTPS'i açın, kurulumun soracağı erişim anahtarını (auth key) https://console.tailscale.com/admin/settings/keys sayfasında oluşturun.",
              "**Herkese açık bir alan adı**: internetteki herkes açabilir, örneğin `https://chat.example.com` adresinde. Alan adını sunucuya yönlendirin ve 80 ile 443 portlarını açın. Kurulum sertifikayı alır ve yeniler, alan adı yayına girmeden önce de hesabınızı oluşturmanızı ister.",
              "**Yalnızca bu makine**: `http://localhost:3000`, kendi bilgisayarınızda denemek için.",
            ],
          },
          "Tailscale'de sunucu, anahtarının süresi 180 gün sonra dolunca ağınızdan çıkar. Kalması için https://console.tailscale.com/admin/machines sayfasında sunucunun **⋯** menüsünü açıp **Disable Key Expiry** seçin.",
          "Rutin başlatan webhook'lar ve kendi sunucularından çağrı yapan yapay zekâ uygulamaları herkese açık bir adrese ihtiyaç duyar. Tailscale'de Funnel aynı adresi internete açar: https://console.tailscale.com/admin/acls sayfasında Funnel'ı tailnet politikanıza ekleyin ve `.env` içinde `TAILSCALE_FUNNEL=true` ayarlayın, sonra `docker compose up -d` çalıştırın.",
        ],
      },
      {
        id: "owner",
        heading: "Hesabınız",
        blocks: [
          "Sunucunuzun adresini açın ve kaydolun: ilk hesap sahip olur. Ardından kayıt kapanır ve insanlar **Ayarlar\u00a0›\u00a0Üyeler ve davetler** üzerinden gönderilen davetle katılır.",
          "Tailscale'de davet ettiğiniz kişilerin de tailnet'inizde olması gerekir. Onları önce https://console.tailscale.com/admin/users sayfasında, sonra agentes.chat'te davet edin.",
        ],
      },
      {
        id: "email",
        heading: "E-posta",
        blocks: [
          "E-posta yoksa agentes.chat her e-postayı göndermek yerine günlüğüne yazar, böylece bir davet bağlantısını oradan kopyalayabilirsiniz. Parola sıfırlama kapalı kalır.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "Kurulum kendi posta sunucunuzu (SMTP) ya da MillionSend veya Resend gibi Resend uyumlu bir API anahtarını kabul eder. Başka bir gönderen seçmezseniz e-postalar sunucunuzun alan adındaki `ping@` adresinden gider ve bu alan adının e-posta sağlayıcınızda doğrulanmış olması gerekir. Sonra ayarlamak için kurulumu yeniden çalıştırın.",
        ],
      },
      {
        id: "phone",
        heading: "Telefonunuz",
        blocks: [
          {
            list: [
              "Tailscale'de telefonunuza Tailscale uygulamasını kurun ve aynı tailnet'e giriş yapın.",
              "agentes.chat uygulamasını kurun.",
              "Kurulumun gösterdiği QR kodunu ya da **Ayarlar\u00a0›\u00a0Hesabınız\u00a0›\u00a0Telefonunuzda açın** içindekini tarayın. İkincisi oturumunuzu da açar.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "Ajanlarınızın bilgisayarları",
        blocks: [
          "Kurulum bu sunucuyu ajanlarınızın bilgisayarı da yapabilir: komutları orada çalıştırır, bir tarayıcı kullanır ve dosyalarını orada tutarlar. Kurulum sorar ve sunucu bunu iyi kaldırabiliyorsa evet önerir. Debian 13'te her ajanın ekranı olan kendi kullanıcısı olur. Ubuntu'da ajanlar tek bir kullanıcıyı, `agentes` kullanıcısını paylaşır. Hayır dediyseniz kurulumu `--computer yes` ile yeniden çalıştırın:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "agentes.chat uygulamalı bir Mac ya da başka bir sunucu gibi diğer bilgisayarlar **Ayarlar\u00a0›\u00a0Cihazlar** üzerinden bağlanır, [Bilgisayarlarınız ve telefonlarınız](/help/computers) sayfasındaki gibi. Tailscale'de önce tailnet'inize katılırlar.",
        ],
      },
      {
        id: "backups",
        heading: "Yedekler ve geri yükleme",
        blocks: [
          "Sunucunuz üç şeyden oluşur: veritabanı, yüklenen dosyalar ve `.env` içindeki `AGENTES_SECRET`. `.env` dosyasının bir kopyasını yedeklerden ayrı, güvenli bir yerde tutun: bu sır olmadan, geri yüklenen bir veritabanındaki anahtarlar okunamaz.",
          "Her gün yedek için Cloudflare R2'de ya da S3 uyumlu başka bir depolamada özel bir bucket ve orada okuyup yazabilen ve silebilen bir anahtar oluşturun. Bunları `.env` içine ekleyin, `COMPOSE_PROFILES` içine de `backup` ekleyin (herkese açık bir alan adıyla `https,backup`):",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "Ardından kurulum klasöründe `docker compose up -d` çalıştırın. Veritabanının dökümü 03:00 UTC'de alınır ve her döküm 14 gün tutulur. `docker compose run --rm backup now` hemen bir tane alır, `docker compose run --rm backup list` hepsini listeler. Dökümlerde yalnızca veritabanı vardır: `files` biriminde duran yüklenen dosyaların ayrı bir kopyası gerekir, komutları aşağıdaki tam kılavuzda.",
          "Geri yüklemek için bir dökümü `docker compose run --rm -T backup fetch <ad> > agentes.dump` ile indirin, sonra uygulama durmuşken boş bir veritabanına yükleyin:",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "Dökümü alan sürüme ya da daha yeni bir sürüme geri yükleyin.",
        ],
      },
      {
        id: "upgrades",
        heading: "Güncellemeler",
        blocks: [
          "Kurulum klasöründe şunu çalıştırın:",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "Yeni sürüm başlarken veritabanı kendini günceller. Ayarlarınızı `.env` içinde tutun ve `docker-compose.yml` dosyasını asla düzenlemeyin, çünkü her güncelleme onu değiştirir. Büyük bir sıçramadan önce yedek alın: daha yeni bir sürümün güncellediği bir veritabanı eski bir sürümde açılmaz.",
        ],
      },
      {
        id: "data",
        heading: "Ne gönderir",
        blocks: [
          "Sunucu günde bir kez agentes.chat'e anonim kullanım istatistikleri gönderir: kişi, ajan sayısı, makine boyutları, kullanılan yapay zekâ token'ları ve ajanların tarayıcılarının ne kadar veri gönderip aldığı gibi sayılar. Asla mesajlar, dosyalar, adlar ya da siteler. `docker compose run --rm agentes telemetry` tam olarak ne gönderileceğini gösterir. Sahip bunu **Ayarlar\u00a0›\u00a0Genel** içinden ya da `.env` içinde `TELEMETRY=off` ile kapatır.",
          "Hata raporları, `SENTRY_DSN` ile kendi seçtiğiniz Sentry uyumlu bir sunucu ayarlamadıkça hiçbir yere gitmez. Bir rapor hatayı ve nerede olduğunu içerir, asla mesajları, e-postaları, IP adreslerini, çerezleri ya da token'ları içermez.",
        ],
      },
      {
        id: "reference",
        heading: "Tam kılavuz",
        blocks: [
          "Tüm ayarlar, nginx gibi kendi proxy'niz, Docker olmadan çalıştırma, kendi kendine kuran yapay zekâ ajanları için bir adım listesi ve bir şey ters gittiğinde ne yapılacağı, agentes.chat deposundaki `SELF_HOSTING.md` dosyasında.",
        ],
      },
    ],
  },
};
