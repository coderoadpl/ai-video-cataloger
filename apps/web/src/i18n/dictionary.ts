export type Locale = 'en' | 'pl';

export interface Dictionary {
  locale: Locale;
  common: {
    save: string;
    cancel: string;
    close: string;
    back: string;
    next: string;
    openSettings: string;
  };
  language: {
    stepTitle: string;
    stepDescription: string;
    uiLabel: string;
    uiHelper: string;
    outputLabel: string;
    outputHelper: string;
    optionAuto: string;
    optionEnglish: string;
    optionPolish: string;
  };
  settings: {
    languageSectionTitle: string;
  };
  people: {
    disabledTitle: string;
    disabledBody: string;
    emptyTitle: string;
    emptyBody: string;
  };
}

export const en: Dictionary = {
  locale: 'en',
  common: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    openSettings: 'Open Settings',
  },
  language: {
    stepTitle: 'Language',
    stepDescription: 'Choose the interface language and the language for generated descriptions and filenames. You can change both later in Settings.',
    uiLabel: 'App language',
    uiHelper: 'Language of the desktop app interface.',
    outputLabel: 'Description language',
    outputHelper: 'Language the AI writes descriptions and filenames in. Tags always stay in English.',
    optionAuto: 'Automatic (model chooses)',
    optionEnglish: 'English',
    optionPolish: 'Polish',
  },
  settings: {
    languageSectionTitle: 'Language',
  },
  people: {
    disabledTitle: 'Face grouping is off',
    disabledBody: 'Turn on local face grouping in Settings to group the people who appear across your videos.',
    emptyTitle: 'No people yet',
    emptyBody: 'Index the current folder to find and group faces across your videos.',
  },
};

export const pl: Dictionary = {
  locale: 'pl',
  common: {
    save: 'Zapisz',
    cancel: 'Anuluj',
    close: 'Zamknij',
    back: 'Wstecz',
    next: 'Dalej',
    openSettings: 'Otwórz ustawienia',
  },
  language: {
    stepTitle: 'Język',
    stepDescription: 'Wybierz język interfejsu oraz język generowanych opisów i nazw plików. Oba możesz później zmienić w Ustawieniach.',
    uiLabel: 'Język aplikacji',
    uiHelper: 'Język interfejsu aplikacji na komputerze.',
    outputLabel: 'Język opisów',
    outputHelper: 'Język, w którym AI pisze opisy i nazwy plików. Tagi zawsze pozostają po angielsku.',
    optionAuto: 'Automatycznie (wybiera model)',
    optionEnglish: 'Angielski',
    optionPolish: 'Polski',
  },
  settings: {
    languageSectionTitle: 'Język',
  },
  people: {
    disabledTitle: 'Grupowanie twarzy jest wyłączone',
    disabledBody: 'Włącz lokalne grupowanie twarzy w Ustawieniach, aby grupować osoby pojawiające się w Twoich filmach.',
    emptyTitle: 'Brak osób',
    emptyBody: 'Zindeksuj bieżący folder, aby znaleźć i pogrupować twarze w Twoich filmach.',
  },
};

export const getDict = (locale: Locale): Dictionary => (locale === 'pl' ? pl : en);
