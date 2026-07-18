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
  features: Array<{
    title: string;
    description: string;
  }>;
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
  '{"type":"started","data":{"video":"IMG_4021.mp4"}}',
  '{"type":"progress","step":"transcribing_audio","percentage":60}',
  '{"type":"completed","data":{"video":"2026-07-18_jellyfish-underwater-scene.mp4","status":"completed"}}',
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
      "v0.1.0 early alpha - free - macOS (Apple Silicon) - .dmg, about 153 MB",
    gatekeeperPrefix:
      "The app is not notarized yet: on first launch, right-click the app and choose Open. Expect rough edges - and ",
    gatekeeperLink: "please report them",
    gatekeeperSuffix: ".",
    imageAlt: "AI Video Cataloger app window",
  },
  beforeAfter: {
    heading: "From camera noise to a searchable library",
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
          "Frames are sampled, speech is transcribed with Whisper, and your chosen AI writes a summary and tags.",
      },
      {
        title: "Named and searchable",
        description:
          "Every file gets a content-based name and lands in a catalog you can browse and search.",
      },
    ],
  },
  features: [
    {
      title: "Names with meaning",
      description:
        "IMG_4021.mp4 becomes jellyfish-underwater-scene.mp4. Filenames are written from what the AI actually sees and hears.",
    },
    {
      title: "Local-first privacy",
      description:
        "Runs entirely on your Mac with local models via Ollama. Nothing leaves your machine unless you opt into an API.",
    },
    {
      title: "Whisper transcription",
      description:
        "Every spoken word becomes searchable text, transcribed on-device with Whisper.",
    },
    {
      title: "Bring your own AI",
      description:
        "Local models, any OpenAI-compatible API with your key, or the agent CLIs you already use: Claude Code, Codex, Cursor.",
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
  privacy: {
    heading: "Private by design",
    intro: "Your footage is personal. The app is built so it can stay that way.",
    cards: [
      {
        title: "Runs on your Mac",
        description:
          "Frames, audio, transcripts, summaries and the catalog live inside your folders. With local models, nothing ever leaves the machine.",
      },
      {
        title: "Cloud only when you say so",
        description:
          "An OpenAI-compatible API or an agent CLI is used only if you configure it - your key, your choice, and only for the analysis step.",
      },
      {
        title: "No telemetry by default",
        description:
          "No analytics, no tracking, no phoning home. The app works fully offline with local models.",
      },
    ],
  },
  cli: {
    heading: "Scriptable to the bone",
    subline:
      "The same engine ships as a first-class CLI: NDJSON events, honest exit codes, perfect for cron jobs and automations.",
    lines: sharedCliLines,
  },
  requirements: {
    heading: "Will it run on your Mac?",
    cloudCallout: {
      title: "With cloud models it always runs",
      body: "Connect your own OpenAI-compatible API key or an agent CLI and any Apple Silicon Mac is enough - the heavy lifting happens elsewhere. Everything below applies to local models only.",
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
          "Comfortable local analysis on mid-size models while you keep working.",
      },
      {
        size: "24 GB+ RAM",
        badge: "headroom",
        description: "Room for larger, noticeably smarter local models.",
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
        label: "Whisper large",
        size: "1.5 GB",
        sizeMb: 1500,
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
    ],
    closing:
      "You choose what to install in the setup wizard - nothing is downloaded without asking.",
  },
  faq: {
    heading: "Questions, answered",
    items: [
      {
        question: "Is my footage private?",
        answer:
          "With local models - the default - everything runs on your Mac: frames, audio, transcripts and summaries never leave your machine. If you connect an OpenAI-compatible API or an agent CLI, only the analysis step goes through that provider, with your key and by your explicit choice. No telemetry by default.",
      },
      {
        question: "What do I need to run it?",
        answer:
          "An Apple Silicon Mac. The setup wizard handles the rest on first launch: it installs a local AI runtime (Ollama) and Whisper, and ffmpeg is bundled with the app.",
      },
      {
        question: "How much disk space do local models take?",
        answer:
          "Whisper models range from about 75 MB to 1.5 GB; local analysis models via Ollama are typically 2-8 GB. You choose what to install in the wizard.",
      },
      {
        question: "Does it work offline?",
        answer:
          "Yes - with local models the whole pipeline is offline. API and agent-CLI backends need network.",
      },
      {
        question: "Does it change my files?",
        answer:
          "It renames videos to the content-based name and keeps the original name in its catalog, stored in a hidden .ai-video-cataloger folder inside your folder. Nothing is uploaded and nothing is deleted.",
      },
      {
        question: "Is it really free?",
        answer:
          "The alpha is free. Local analysis costs nothing; if you bring an API key, your provider bills your usage.",
      },
      {
        question: "Why does macOS warn me on first launch?",
        answer:
          "The app is not yet notarized by Apple - that requires a paid developer account and is on our roadmap. macOS shows this warning for any app downloaded outside the App Store. Right-click the app, choose Open and confirm - you only need to do it once.",
      },
    ],
  },
  cta: {
    heading: "Ready to clean up your video folders?",
    line: "Early alpha. macOS today - Windows and Linux coming soon.",
    button: "Download for macOS",
  },
  footer: {
    builtBy: "AI Video Cataloger - built by CodeRoad",
    version: "v0.1.0 early alpha - macOS only (Apple Silicon)",
    feedback: "Send feedback",
  },
};

export const pl: Dictionary = {
  locale: "pl",
  metadata: {
    title: "AI Video Cataloger - biblioteka wideo porządkowana przez AI na macOS",
    description:
      "Lokalna aplikacja na macOS, która ogląda, transkrybuje i streszcza Twoje wideo, a potem nadaje im nazwy oparte na treści. Bez chmury.",
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
      "AI Video Cataloger ogląda, transkrybuje i streszcza filmy w dowolnym folderze - a potem zmienia im nazwy na takie, które mówią, co jest w środku. Wszystko na Twoim Macu. Bez chmury.",
    primaryButton: "Pobierz na macOS",
    subNote:
      "v0.1.0 wczesna alfa - za darmo - macOS (Apple Silicon) - .dmg, ok. 153 MB",
    gatekeeperPrefix:
      "Aplikacja nie jest jeszcze notaryzowana: przy pierwszym uruchomieniu kliknij prawym przyciskiem i wybierz Otwórz. Spodziewaj się niedoróbek - i ",
    gatekeeperLink: "daj nam o nich znać",
    gatekeeperSuffix: ".",
    imageAlt: "Okno aplikacji AI Video Cataloger",
  },
  beforeAfter: {
    heading: "Z chaosu z kamery do przeszukiwalnej biblioteki",
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
          "Aplikacja próbkuje klatki, transkrybuje mowę Whisperem, a wybrana AI pisze streszczenie i tagi.",
      },
      {
        title: "Nazwane i przeszukiwalne",
        description:
          "Każdy plik dostaje nazwę opartą na treści i trafia do katalogu, który można przeglądać i przeszukiwać.",
      },
    ],
  },
  features: [
    {
      title: "Nazwy z sensem",
      description:
        "IMG_4021.mp4 staje się jellyfish-underwater-scene.mp4. Nazwy plików powstają z tego, co AI naprawdę widzi i słyszy.",
    },
    {
      title: "Prywatność lokalnie",
      description:
        "Działa w całości na Twoim Macu z lokalnymi modelami przez Ollamę. Nic nie opuszcza komputera, chyba że sam włączysz API.",
    },
    {
      title: "Transkrypcja Whisperem",
      description:
        "Każde wypowiedziane słowo staje się przeszukiwalnym tekstem - transkrypcja w całości na urządzeniu.",
    },
    {
      title: "Twoja własna AI",
      description:
        "Modele lokalne, dowolne API zgodne z OpenAI na Twój klucz albo agentowe CLI, których już używasz: Claude Code, Codex, Cursor.",
    },
    {
      title: "Partie jednym kliknięciem",
      description:
        "Wskaż folder i wciśnij jeden przycisk: klatki, audio, transkrypcja, streszczenie i zmiana nazwy dla każdego wideo.",
    },
    {
      title: "GUI i CLI",
      description:
        "Porządna aplikacja desktopowa plus pełnoprawne CLI z wyjściem JSON do skryptów i automatyzacji.",
    },
  ],
  privacy: {
    heading: "Prywatność w standardzie",
    intro:
      "Twoje nagrania to prywatna sprawa. Aplikacja jest zbudowana tak, żeby mogła nią pozostać.",
    cards: [
      {
        title: "Działa na Twoim Macu",
        description:
          "Klatki, audio, transkrypcje, streszczenia i katalog żyją w Twoich folderach. Z modelami lokalnymi nic nigdy nie opuszcza komputera.",
      },
      {
        title: "Chmura tylko na Twoje życzenie",
        description:
          "API zgodne z OpenAI albo agentowe CLI działają wyłącznie wtedy, gdy je skonfigurujesz - Twój klucz, Twoja decyzja i tylko etap analizy.",
      },
      {
        title: "Zero telemetrii domyślnie",
        description:
          "Bez analityki, bez śledzenia, bez dzwonienia do domu. Z modelami lokalnymi aplikacja działa w pełni offline.",
      },
    ],
  },
  cli: {
    heading: "Skryptowalny do szpiku",
    subline:
      "Ten sam silnik działa jako pełnoprawne CLI: zdarzenia NDJSON, uczciwe kody wyjścia - idealne do crona i automatyzacji.",
    lines: sharedCliLines,
  },
  requirements: {
    heading: "Czy to ruszy na Twoim Macu?",
    cloudCallout: {
      title: "Z modelami chmurowymi zadziała zawsze",
      body: "Podłącz własny klucz API zgodny z OpenAI albo agentowe CLI, a wystarczy dowolny Mac z Apple Silicon - ciężka robota dzieje się gdzie indziej. Wszystko poniżej dotyczy wyłącznie modeli lokalnych.",
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
          "Komfortowa analiza lokalna na średnich modelach bez przerywania pracy.",
      },
      {
        size: "24 GB+ RAM",
        badge: "zapas",
        description:
          "Miejsce na większe, zauważalnie mądrzejsze modele lokalne.",
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
        label: "Whisper large",
        size: "1,5 GB",
        sizeMb: 1500,
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
    ],
    closing:
      "O tym, co zainstalować, decydujesz w kreatorze - nic nie pobiera się bez pytania.",
  },
  faq: {
    heading: "Pytania i odpowiedzi",
    items: [
      {
        question: "Czy moje nagrania są prywatne?",
        answer:
          "Z modelami lokalnymi - ustawieniem domyślnym - wszystko dzieje się na Twoim Macu: klatki, audio, transkrypcje i streszczenia nigdy nie opuszczają komputera. Jeśli podłączysz API zgodne z OpenAI albo agentowe CLI, przez dostawcę przechodzi wyłącznie etap analizy - na Twój klucz i za Twoją wyraźną zgodą. Telemetria jest domyślnie wyłączona.",
      },
      {
        question: "Czego potrzebuję, żeby to uruchomić?",
        answer:
          "Maca z Apple Silicon. Resztą zajmuje się kreator przy pierwszym uruchomieniu: instaluje lokalny runtime AI (Ollama) i Whispera, a ffmpeg jest dołączony do aplikacji.",
      },
      {
        question: "Ile miejsca zajmują modele lokalne?",
        answer:
          "Modele Whispera to od ok. 75 MB do 1,5 GB; lokalne modele do analizy przez Ollamę to zwykle 2-8 GB. W kreatorze wybierasz, co zainstalować.",
      },
      {
        question: "Czy działa offline?",
        answer:
          "Tak - z modelami lokalnymi cały proces działa offline. Backendy API i agentowych CLI wymagają sieci.",
      },
      {
        question: "Czy zmienia moje pliki?",
        answer:
          "Zmienia nazwy wideo na oparte na treści, a oryginalną nazwę zachowuje w katalogu zapisanym w ukrytym folderze .ai-video-cataloger wewnątrz Twojego folderu. Nic nie jest wysyłane ani usuwane.",
      },
      {
        question: "Czy to naprawdę darmowe?",
        answer:
          "Alfa jest darmowa. Analiza lokalna nic nie kosztuje; jeśli podasz klucz API, za zużycie rozlicza Cię Twój dostawca.",
      },
      {
        question: "Dlaczego macOS ostrzega przy pierwszym uruchomieniu?",
        answer:
          "Aplikacja nie jest jeszcze notaryzowana przez Apple - wymaga to płatnego konta deweloperskiego i jest w planach. macOS pokazuje takie ostrzeżenie przy każdej aplikacji spoza App Store. Kliknij aplikację prawym przyciskiem, wybierz Otwórz i potwierdź - wystarczy raz.",
      },
    ],
  },
  cta: {
    heading: "Gotowy uporządkować foldery z wideo?",
    line: "Wczesna alfa. Dziś macOS - Windows i Linux wkrótce.",
    button: "Pobierz na macOS",
  },
  footer: {
    builtBy: "AI Video Cataloger - tworzone przez CodeRoad",
    version: "v0.1.0 wczesna alfa - tylko macOS (Apple Silicon)",
    feedback: "Zgłoś uwagi",
  },
};

export function getDict(locale: Locale): Dictionary {
  return locale === "pl" ? pl : en;
}
