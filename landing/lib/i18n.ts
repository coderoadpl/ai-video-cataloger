export type Locale = "en" | "pl";

export type Dictionary = {
  locale: Locale;
  metadata: {
    title: string;
    description: string;
  };
  siteBanner: {
    text: string;
  };
  header: {
    nav: {
      howItWorks: string;
      features: string;
      privacy: string;
      faq: string;
    };
    languageLabel: string;
    download: string;
    themeToggle: {
      light: string;
      dark: string;
    };
  };
  hero: {
    badge: string;
    title: string;
    description: string;
    primaryButton: string;
    subNote: string;
    gatekeeperPrefix: string;
    gatekeeperLink: string;
    gatekeeperSuffix: string;
    imageAlt: string;
  };
  beforeAfter: {
    heading: string;
    subline: string;
    renames: Array<{
      oldName: string;
      newName: string;
    }>;
  };
  howItWorks: {
    heading: string;
    steps: Array<{
      title: string;
      description: string;
    }>;
  };
  features: {
    heading: string;
    subheading: string;
    items: Array<{
      title: string;
      description: string;
    }>;
  };
  privacy: {
    heading: string;
    intro: string;
    cards: Array<{
      title: string;
      description: string;
    }>;
  };
  cli: {
    heading: string;
    subline: string;
    lines: string[];
  };
  requirements: {
    heading: string;
    cloudCallout: {
      title: string;
      body: string;
    };
    baseline: string;
    tiers: Array<{
      size: string;
      badge: string;
      description: string;
    }>;
    warning: string;
    memoryNote: string;
    diskHeading: string;
    diskItems: Array<{
      label: string;
      size: string;
      sizeMb: number;
    }>;
    closing: string;
  };
  recommendations: {
    heading: string;
    disclaimer: string;
    scenarios: Array<{
      heading: string;
      rows: Array<{
        label: string;
        description: string;
      }>;
    }>;
    tosCallout: string;
    whisperCallout: string;
  };
  faq: {
    heading: string;
    items: Array<{
      question: string;
      answer: string;
    }>;
  };
  cta: {
    heading: string;
    line: string;
    button: string;
  };
  footer: {
    builtBy: string;
    version: string;
    feedback: string;
  };
};

const sharedRenames = [
  {
    oldName: "IMG_4021.mp4",
    newName: "2026-07-18_jellyfish-underwater-scene.mp4",
  },
  {
    oldName: "VID_20250612_183355.mp4",
    newName: "2026-07-18_gatekeeper-desert-dragon.mp4",
  },
  {
    oldName: "clip_final_v2.mp4",
    newName: "2026-07-18_pasta-with-tomato-sauce.mp4",
  },
];

const sharedCliLines = [
  "$ ai-video-cataloger process ~/Movies/IMG_4021.mp4 --json",
  '{"type":"started","timestamp":"2026-07-18T10:15:00.000Z","command":"process_single","data":{"videoPath":"/Users/.../Movies/IMG_4021.mp4","options":{"frames":3,"skipRename":false,"timeout":120,"whisper":"local","whisperModel":"base"}}}',
  '{"type":"progress","timestamp":"2026-07-18T10:15:24.000Z","step":"transcribing_audio","percentage":60}',
  '{"type":"completed","timestamp":"2026-07-18T10:16:12.000Z","data":{"video":"IMG_4021.mp4","path":"/Users/.../Movies/2026-07-18_jellyfish-underwater-scene.mp4","status":"completed"}}',
];

export const en: Dictionary = {
  locale: "en",
  metadata: {
    title: "AI Video Cataloger - AI-organized video library for macOS",
    description:
      "Local-first macOS app that watches, transcribes, summarizes and renames videos by what is inside, with local Ollama, OpenAI-compatible APIs, or agent CLIs.",
  },
  siteBanner: {
    text: "Early alpha - macOS only (Apple Silicon) - free download",
  },
  header: {
    nav: {
      howItWorks: "How it works",
      features: "Features",
      privacy: "Privacy",
      faq: "FAQ",
    },
    languageLabel: "Language",
    download: "Download",
    themeToggle: {
      light: "Switch to light mode",
      dark: "Switch to dark mode",
    },
  },
  hero: {
    badge: "Local-first AI for your video library",
    title: "Give every video a name that means something.",
    description:
      "AI Video Cataloger watches, transcribes and summarizes the videos in any folder - then renames them by what is actually inside. All on your Mac. No cloud required.",
    primaryButton: "Download for macOS",
    subNote:
      "v0.3.0 early alpha - free - macOS (Apple Silicon) - .dmg, about 153 MB",
    gatekeeperPrefix:
      "The app is not notarized yet: on first launch, right-click the app and choose Open. If macOS still refuses, allow it in System Settings -> Privacy & Security -> Open Anyway. Expect rough edges - and ",
    gatekeeperLink: "please report them",
    gatekeeperSuffix: ".",
    imageAlt: "AI Video Cataloger app window",
  },
  beforeAfter: {
    heading: "From camera noise to an organized library",
    subline: "Real output from the app - these are actual renames it produced:",
    renames: sharedRenames,
  },
  howItWorks: {
    heading: "How it works",
    steps: [
      {
        title: "Point it at a folder",
        description:
          "Pick any folder of videos. Nothing is uploaded and nothing is moved.",
      },
      {
        title: "AI watches and listens",
        description:
          "Frames are sampled, speech is transcribed with Whisper, and your chosen AI writes a summary.",
      },
      {
        title: "Named and organized",
        description:
          "Every file gets a content-based name and lands in a catalog you can browse.",
      },
    ],
  },
  features: {
    heading: "What it does",
    subheading: "Six things you stop doing by hand.",
    items: [
      {
        title: "Names with meaning",
        description:
          "IMG_4021.mp4 becomes 2026-07-18_jellyfish-underwater-scene.mp4. Filenames are written from what the AI actually sees and hears.",
      },
      {
        title: "Local-first privacy",
        description:
          "Runs entirely on your Mac with local models via Ollama. Nothing leaves your machine unless you opt into an API.",
      },
      {
        title: "Whisper transcription",
        description:
          "Every spoken word is transcribed on-device into a transcript saved next to your video.",
      },
      {
        title: "Bring your own AI",
        description:
          "Local models, any OpenAI-compatible API with your key, or the agent CLIs you already use: Claude Code, Codex, Cursor Agent.",
      },
      {
        title: "One-click batches",
        description:
          "Point at a folder and press one button: frames, audio, transcript, summary and rename for every video in it.",
      },
      {
        title: "GUI and CLI",
        description:
          "A clean desktop app plus a first-class CLI with JSON output for scripts and automation.",
      },
    ],
  },
  privacy: {
    heading: "Private by design",
    intro: "Your footage is personal. The app is built so it can stay that way.",
    cards: [
      {
        title: "Runs on your Mac",
        description:
          "Frames, transcripts, summaries and the catalog live inside your folders. With local models, nothing ever leaves the machine.",
      },
      {
        title: "Cloud only when you say so",
        description:
          "An OpenAI-compatible API or an agent CLI handles only the steps you route to it - analysis, and transcription if you pick the Whisper API mode. Your key, your choice.",
      },
      {
        title: "No telemetry",
        description:
          "No analytics, no tracking, no phoning home. After the initial setup the app works fully offline with local models.",
      },
    ],
  },
  cli: {
    heading: "Scriptable to the bone",
    subline:
      "The same engine ships as a first-class CLI: NDJSON events, honest exit codes, perfect for cron jobs and automations. Install it from the app menu: AI Video Cataloger -> Install Command Line Tool.",
    lines: sharedCliLines,
  },
  requirements: {
    heading: "Will it run on your Mac?",
    cloudCallout: {
      title: "With cloud models it always runs",
      body: "Connect your own OpenAI-compatible API key or an agent CLI and any Apple Silicon Mac is enough - the heavy lifting happens elsewhere. Everything below applies to local models only. Transcription still runs locally by default with the small Whisper models, which any M-series Mac handles.",
    },
    baseline:
      "Apple Silicon Mac (M1 or newer) - macOS - the app itself is a ~153 MB download",
    tiers: [
      {
        size: "8 GB RAM",
        badge: "minimum",
        description:
          "Enough for the smallest local models - expect the Mac to be busy while it analyzes.",
      },
      {
        size: "16 GB RAM",
        badge: "recommended",
        description:
          "Runs the mid-size 12B models - the sweet spot of quality vs. resources.",
      },
      {
        size: "32 GB+ RAM",
        badge: "headroom",
        description: "Unlocks the largest local models - up to the 17 GB 27B tier.",
      },
    ],
    warning:
      "A local model has to fit in memory next to macOS and your other apps - the system alone uses several GB of RAM.",
    memoryNote:
      "On Apple Silicon there is no separate VRAM - the GPU shares unified memory with the system, so total RAM is the number that matters.",
    diskHeading: "Disk space for models",
    diskItems: [
      {
        label: "Whisper tiny",
        size: "75 MB",
        sizeMb: 75,
      },
      {
        label: "Whisper large-v3",
        size: "3.1 GB",
        sizeMb: 3174,
      },
      {
        label: "Vision model (4B)",
        size: "~3.3 GB",
        sizeMb: 3300,
      },
      {
        label: "Vision model (12B)",
        size: "~8 GB",
        sizeMb: 8000,
      },
      {
        label: "Vision model (27B)",
        size: "~17 GB",
        sizeMb: 17408,
      },
    ],
    closing:
      "You choose what to install in the setup wizard - nothing is downloaded without asking.",
  },
  recommendations: {
    heading: "Which setup should you choose?",
    disclaimer:
      "These recommendations assume short, social-media-style clips (tens of seconds up to ~2 minutes) - that is what we benchmarked internally (July 2026). The app works on longer videos too, but we have not benchmarked them.",
    scenarios: [
      {
        heading: "A small batch - e.g. one day of footage (a few dozen clips)",
        rows: [
          {
            label: "Claude subscription",
            description:
              "Best quality: the Claude Code harness with Fable - in our internal benchmark the only setup that beat a hand-curated reference. Cost-efficient: Opus 4.8. Around 40 s per clip, so a day of footage takes minutes.",
          },
          {
            label: "ChatGPT subscription",
            description:
              "The Codex harness with gpt-5.6-luna - the best Codex quality in our benchmark and the lightest on plan limits.",
          },
          {
            label: "Fully local",
            description:
              "Depends on your Mac. 16 GB+ - gemma3:12b gives a decent draft you will want to touch up; 8 GB - gemma3:4b works, but treat the names as placeholders.",
          },
        ],
      },
      {
        heading: "A whole drive (1-2 TB)",
        rows: [
          {
            label: "Default route",
            description:
              "Your own API key (gpt-5.5) + local Whisper - about 14 s per clip (~30-40 h per TB running in the background), pennies per clip, quality close to the harnesses.",
          },
          {
            label: "Subscription harnesses",
            description:
              "Not suited to bulk processing: ~40 s per clip plus plan limits. A sensible hybrid: run the whole drive through the API, then re-run your 50-100 most important clips through the harness.",
          },
          {
            label: "Fully local",
            description:
              "16 GB+ can run gemma3:12b overnight (~60-75 h per TB), free and offline, but expect draft-quality names.",
          },
        ],
      },
    ],
    tosCallout:
      "Harness modes drive your subscription tool (Claude Code / Codex CLI) automatically. Occasional batches are normal plan usage; mass processing may conflict with your plan's terms and limits - check your provider's ToS. For large volumes, an API key is the honest route.",
    whisperCallout:
      "Independent of everything above: keep transcription local. Whisper large-v3-turbo runs on any Apple Silicon GPU at 2-4 s per clip, free and offline - there is no reason to pay for cloud transcription or upload your audio.",
  },
  faq: {
    heading: "Questions, answered",
    items: [
      {
        question: "Is my footage private?",
        answer:
          "With local models - the setup the wizard recommends - everything runs on your Mac: frames, audio, transcripts and summaries never leave your machine. If you connect an OpenAI-compatible API or an agent CLI, only the steps you route there go through that provider. The app contains no telemetry at all.",
      },
      {
        question: "What do I need to run it?",
        answer:
          "An Apple Silicon Mac. On first launch the setup wizard installs whatever your choices need - for the fully local setup that means the local AI runtime (Ollama) and Whisper. ffmpeg is bundled with the app.",
      },
      {
        question: "How much disk space do local models take?",
        answer:
          "Whisper models range from about 75 MB to 3.1 GB; local vision models from about 3.3 GB to 17 GB. You choose what to install in the wizard.",
      },
      {
        question: "Does it work offline?",
        answer:
          "Yes - once the initial setup has downloaded your chosen models, the whole local pipeline runs offline. API and agent-CLI backends need network.",
      },
      {
        question: "Does it change my files?",
        answer:
          "It renames videos to the content-based name and keeps the original name in its catalog. Alongside your videos it creates frames/, transcripts/ and summaries/ folders with the extracted artifacts, plus a hidden .ai-video-cataloger folder with the catalog - all deletable at any time. It scans only the top level of the folder (mp4, mov, avi, mkv, webm). Nothing is uploaded and nothing is deleted.",
      },
      {
        question: "Is it really free?",
        answer:
          "The alpha is free. Local analysis costs nothing; if you bring an API key, your provider bills your usage.",
      },
      {
        question: "Why does macOS warn me on first launch?",
        answer:
          "The app is not yet notarized by Apple - that requires a paid developer account and is on our roadmap. macOS shows this warning for apps that are not notarized. Right-click the app and choose Open; if the option does not appear, go to System Settings -> Privacy & Security and click Open Anyway. You only need to do it once.",
      },
    ],
  },
  cta: {
    heading: "Ready to clean up your video folders?",
    line: "Early alpha. macOS today - Windows and Linux in the future.",
    button: "Download for macOS",
  },
  footer: {
    builtBy: "AI Video Cataloger - built by CodeRoad",
    version: "v0.3.0 early alpha - macOS only (Apple Silicon)",
    feedback: "Send feedback",
  },
};

export const pl: Dictionary = {
  locale: "pl",
  metadata: {
    title: "AI Video Cataloger - biblioteka wideo porządkowana przez AI na macOS",
    description:
      "Lokalna aplikacja na macOS, która ogląda, transkrybuje i streszcza Twoje wideo, a potem nadaje im nazwy oparte na treści - z lokalną Ollamą, dowolnym API zgodnym z OpenAI albo agentowym CLI. Chmura niewymagana.",
  },
  siteBanner: {
    text: "Wczesna alfa - tylko macOS (Apple Silicon) - pobierz za darmo",
  },
  header: {
    nav: {
      howItWorks: "Jak to działa",
      features: "Funkcje",
      privacy: "Prywatność",
      faq: "FAQ",
    },
    languageLabel: "Język",
    download: "Pobierz",
    themeToggle: {
      light: "Przełącz na jasny motyw",
      dark: "Przełącz na ciemny motyw",
    },
  },
  hero: {
    badge: "Lokalna AI dla Twojej biblioteki wideo",
    title: "Nadaj każdemu wideo nazwę, która coś znaczy.",
    description:
      "AI Video Cataloger ogląda, transkrybuje i streszcza filmy w dowolnym folderze - a potem zmienia im nazwy na takie, które mówią, co jest w środku. Wszystko na Twoim Macu. Chmura - tylko jeśli sam chcesz.",
    primaryButton: "Pobierz na macOS",
    subNote:
      "v0.3.0 wczesna alfa - za darmo - macOS (Apple Silicon) - .dmg, ok. 153 MB",
    gatekeeperPrefix:
      "Aplikacja nie jest jeszcze notaryzowana: przy pierwszym uruchomieniu kliknij prawym przyciskiem i wybierz Otwórz. Jeśli macOS dalej odmawia, zezwól w Ustawienia systemowe -> Prywatność i ochrona -> Otwórz mimo to. Spodziewaj się niedoróbek - i ",
    gatekeeperLink: "daj nam o nich znać",
    gatekeeperSuffix: ".",
    imageAlt: "Okno aplikacji AI Video Cataloger",
  },
  beforeAfter: {
    heading: "Z chaosu z kamery do uporządkowanej biblioteki",
    subline:
      "Prawdziwe wyniki działania aplikacji - dokładnie takie zmiany nazw wykonała:",
    renames: sharedRenames,
  },
  howItWorks: {
    heading: "Jak to działa",
    steps: [
      {
        title: "Wskaż folder",
        description:
          "Wybierz dowolny folder z wideo. Nic nie jest wysyłane ani przenoszone.",
      },
      {
        title: "AI ogląda i słucha",
        description:
          "Aplikacja próbkuje klatki, transkrybuje mowę Whisperem, a wybrana AI pisze streszczenie.",
      },
      {
        title: "Nazwane i uporządkowane",
        description:
          "Każdy plik dostaje nazwę opartą na treści i trafia do katalogu, który możesz przeglądać.",
      },
    ],
  },
  features: {
    heading: "Co potrafi",
    subheading: "Sześć rzeczy, których nie robisz już ręcznie.",
    items: [
      {
        title: "Nazwy z sensem",
        description:
          "IMG_4021.mp4 staje się 2026-07-18_jellyfish-underwater-scene.mp4. Nazwy plików powstają z tego, co AI naprawdę widzi i słyszy.",
      },
      {
        title: "Prywatność lokalnie",
        description:
          "Działa w całości na Twoim Macu z lokalnymi modelami przez Ollamę. Nic nie opuszcza komputera, chyba że sam włączysz API.",
      },
      {
        title: "Transkrypcja Whisperem",
        description:
          "Każde wypowiedziane słowo trafia do transkrypcji zapisywanej obok wideo - w całości na urządzeniu.",
      },
      {
        title: "Twoja własna AI",
        description:
          "Modele lokalne, dowolne API zgodne z OpenAI z użyciem Twojego klucza albo agentowe CLI, których już używasz: Claude Code, Codex, Cursor Agent.",
      },
      {
        title: "Cały folder jednym kliknięciem",
        description:
          "Wskaż folder i wciśnij jeden przycisk: klatki, audio, transkrypcja, streszczenie i zmiana nazwy dla każdego wideo.",
      },
      {
        title: "GUI i CLI",
        description:
          "Porządna aplikacja desktopowa plus pełnoprawne CLI z wyjściem JSON do skryptów i automatyzacji.",
      },
    ],
  },
  privacy: {
    heading: "Prywatność w standardzie",
    intro:
      "Twoje nagrania to prywatna sprawa. Aplikacja jest zbudowana tak, żeby mogła nią pozostać.",
    cards: [
      {
        title: "Działa na Twoim Macu",
        description:
          "Klatki, transkrypcje, streszczenia i katalog żyją w Twoich folderach. Z modelami lokalnymi nic nigdy nie opuszcza komputera.",
      },
      {
        title: "Chmura tylko na Twoje życzenie",
        description:
          "API zgodne z OpenAI albo agentowe CLI obsługują tylko te kroki, które sam im wskażesz - analizę, a przy trybie Whisper API także transkrypcję. Twój klucz, Twoja decyzja.",
      },
      {
        title: "Zero telemetrii",
        description:
          "Bez analityki, bez śledzenia, bez łączenia się z naszymi serwerami. Po pierwszej konfiguracji aplikacja działa z modelami lokalnymi w pełni offline.",
      },
    ],
  },
  cli: {
    heading: "Skryptowalny do szpiku kości",
    subline:
      "Ten sam silnik działa jako pełnoprawne CLI: zdarzenia NDJSON, uczciwe kody wyjścia - idealne do crona i automatyzacji. Zainstalujesz je z menu aplikacji: AI Video Cataloger -> Install Command Line Tool.",
    lines: sharedCliLines,
  },
  requirements: {
    heading: "Czy to ruszy na Twoim Macu?",
    cloudCallout: {
      title: "Z modelami chmurowymi zadziała zawsze",
      body: "Podłącz własny klucz API zgodny z OpenAI albo agentowe CLI, a wystarczy dowolny Mac z Apple Silicon - ciężka robota dzieje się gdzie indziej. Wszystko poniżej dotyczy wyłącznie modeli lokalnych. Transkrypcja nadal działa domyślnie lokalnie na małych modelach Whispera, z którymi poradzi sobie każdy Mac z serii M.",
    },
    baseline:
      "Mac z Apple Silicon (M1 lub nowszy) - macOS - sama aplikacja to pobranie ok. 153 MB",
    tiers: [
      {
        size: "8 GB RAM",
        badge: "minimum",
        description:
          "Wystarczy dla najmniejszych modeli lokalnych - podczas analizy Mac będzie wyraźnie zajęty.",
      },
      {
        size: "16 GB RAM",
        badge: "zalecane",
        description:
          "Uruchamia średnie modele 12B - najlepszy stosunek jakości do zasobów.",
      },
      {
        size: "32 GB+ RAM",
        badge: "zapas",
        description:
          "Odblokowuje największe modele lokalne - aż po 17-gigabajtowy wariant 27B.",
      },
    ],
    warning:
      "Model lokalny musi zmieścić się w pamięci obok macOS i Twoich pozostałych aplikacji - sam system zajmuje kilka GB RAM-u.",
    memoryNote:
      "W Apple Silicon nie ma osobnego VRAM-u - GPU dzieli pamięć zunifikowaną z systemem, więc liczy się łączny RAM.",
    diskHeading: "Miejsce na dysku na modele",
    diskItems: [
      {
        label: "Whisper tiny",
        size: "75 MB",
        sizeMb: 75,
      },
      {
        label: "Whisper large-v3",
        size: "3,1 GB",
        sizeMb: 3174,
      },
      {
        label: "Model wizyjny (4B)",
        size: "ok. 3,3 GB",
        sizeMb: 3300,
      },
      {
        label: "Model wizyjny (12B)",
        size: "ok. 8 GB",
        sizeMb: 8000,
      },
      {
        label: "Model wizyjny (27B)",
        size: "ok. 17 GB",
        sizeMb: 17408,
      },
    ],
    closing:
      "O tym, co zainstalować, decydujesz w kreatorze - nic nie pobiera się bez pytania.",
  },
  recommendations: {
    heading: "Którą konfigurację wybrać?",
    disclaimer:
      "Rekomendacje zakładają krótkie klipy w stylu social media (kilkadziesiąt sekund do ~2 minut) - takie testowaliśmy w wewnętrznym benchmarku (lipiec 2026). Aplikacja działa też na dłuższych nagraniach, ale ich nie benchmarkowaliśmy.",
    scenarios: [
      {
        heading: "Mały zrzut - np. nagrania z jednego dnia (kilkadziesiąt klipów)",
        rows: [
          {
            label: "Subskrypcja Claude",
            description:
              "Najlepsza jakość: harness Claude Code z Fable - w naszym wewnętrznym benchmarku jako jedyny pobił ręcznie przygotowaną referencję. Oszczędnie: Opus 4.8. Około 40 s na klip, więc zrzut z całego dnia zajmuje minuty.",
          },
          {
            label: "Subskrypcja ChatGPT",
            description:
              "Harness Codex z gpt-5.6-luna - najlepsza jakość spośród modeli Codexa w naszym benchmarku i najlżejsza dla limitów planu.",
          },
          {
            label: "W pełni lokalnie",
            description:
              "Zależy od Maca. 16 GB+ - gemma3:12b daje przyzwoity szkic do ręcznej korekty; 8 GB - gemma3:4b zadziała, ale nazwy traktuj jako robocze.",
          },
        ],
      },
      {
        heading: "Cały dysk (1-2 TB)",
        rows: [
          {
            label: "Domyślna droga",
            description:
              "Własny klucz API (gpt-5.5) + lokalny Whisper - ok. 14 s na klip (~30-40 h na terabajt w tle), groszowe koszty, jakość o włos od harnessów.",
          },
          {
            label: "Harnessy subskrypcyjne",
            description:
              "Nie nadają się do masówki: ~40 s na klip plus limity planu. Sensowna hybryda: cały dysk przez API, a potem 50-100 najważniejszych klipów jeszcze raz przez harness.",
          },
          {
            label: "W pełni lokalnie",
            description:
              "16 GB+ udźwignie gemma3:12b nockami (~60-75 h na terabajt), za darmo i offline, ale nazwy będą szkicowe.",
          },
        ],
      },
    ],
    tosCallout:
      "Tryby harness sterują Twoim narzędziem subskrypcyjnym (Claude Code / Codex CLI) automatycznie. Okazjonalne partie to normalne użycie planu, ale masowe przetwarzanie może być niezgodne z warunkami i limitami subskrypcji - sprawdź ToS dostawcy. Do dużych wolumenów uczciwą drogą jest klucz API.",
    whisperCallout:
      "Niezależnie od wszystkiego powyżej: transkrypcję rób lokalnie. Whisper large-v3-turbo działa na GPU każdego Apple Silicon w 2-4 s na klip, za darmo i offline - nie ma po co płacić za transkrypcję w chmurze ani wysyłać audio.",
  },
  faq: {
    heading: "Pytania i odpowiedzi",
    items: [
      {
        question: "Czy moje nagrania są prywatne?",
        answer:
          "Z modelami lokalnymi - konfiguracją, którą poleca kreator - wszystko dzieje się na Twoim Macu: klatki, audio, transkrypcje i streszczenia nie opuszczają komputera. Jeśli podłączysz API zgodne z OpenAI albo agentowe CLI, przez dostawcę przechodzą tylko wskazane przez Ciebie kroki. Aplikacja nie zawiera żadnej telemetrii.",
      },
      {
        question: "Czego potrzebuję, żeby to uruchomić?",
        answer:
          "Maca z Apple Silicon. Przy pierwszym uruchomieniu kreator instaluje to, czego wymagają Twoje wybory - przy w pełni lokalnej konfiguracji to lokalne środowisko AI (Ollama) i Whisper. ffmpeg jest dołączony do aplikacji.",
      },
      {
        question: "Ile miejsca zajmują modele lokalne?",
        answer:
          "Modele Whispera to od ok. 75 MB do 3,1 GB; lokalne modele wizyjne od ok. 3,3 GB do 17 GB. W kreatorze wybierasz, co zainstalować.",
      },
      {
        question: "Czy działa offline?",
        answer:
          "Tak - gdy kreator pobierze wybrane modele, cały lokalny proces działa offline. Backendy API i agentowe CLI wymagają sieci.",
      },
      {
        question: "Czy zmienia moje pliki?",
        answer:
          "Zmienia nazwy wideo na oparte na treści, a oryginalną nazwę zachowuje w katalogu. Obok wideo tworzy foldery frames/, transcripts/ i summaries/ z artefaktami oraz ukryty folder .ai-video-cataloger z katalogiem - wszystko można w każdej chwili usunąć. Skanuje tylko pierwszy poziom folderu (mp4, mov, avi, mkv, webm). Nic nie jest wysyłane ani usuwane.",
      },
      {
        question: "Czy to naprawdę darmowe?",
        answer:
          "Alfa jest darmowa. Analiza lokalna nic nie kosztuje; jeśli podasz klucz API, za zużycie rozlicza Cię Twój dostawca.",
      },
      {
        question: "Dlaczego macOS ostrzega przy pierwszym uruchomieniu?",
        answer:
          "Aplikacja nie jest jeszcze notaryzowana przez Apple - wymaga to płatnego konta deweloperskiego i jest w planach. macOS pokazuje takie ostrzeżenie przy aplikacjach bez notaryzacji. Kliknij prawym przyciskiem i wybierz Otwórz; jeśli opcja się nie pojawi, wejdź w Ustawienia systemowe -> Prywatność i ochrona i kliknij Otwórz mimo to. Wystarczy raz.",
      },
    ],
  },
  cta: {
    heading: "Czas uporządkować foldery z wideo?",
    line: "Wczesna alfa. Obecnie macOS - Windows i Linux w przyszłości.",
    button: "Pobierz na macOS",
  },
  footer: {
    builtBy: "AI Video Cataloger - tworzone przez CodeRoad",
    version: "v0.3.0 wczesna alfa - tylko macOS (Apple Silicon)",
    feedback: "Zgłoś uwagi",
  },
};

export function getDict(locale: Locale): Dictionary {
  return locale === "pl" ? pl : en;
}
