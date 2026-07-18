"use client";

import { useEffect, useState } from "react";

const choiceKey = "avc-lang-choice";

export function LangBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const storedChoice = window.localStorage.getItem(choiceKey);
    const preferredLanguages = [
      navigator.language,
      ...(navigator.languages ?? []),
    ].filter(Boolean);
    const prefersPolish = preferredLanguages.some((language) =>
      language.toLowerCase().startsWith("pl")
    );

    if (storedChoice === "pl" || (!storedChoice && prefersPolish)) {
      setVisible(true);
    }
  }, []);

  function choosePolish() {
    window.localStorage.setItem(choiceKey, "pl");
    window.location.href = "/pl/";
  }

  function stayEnglish() {
    window.localStorage.setItem(choiceKey, "en");
    setVisible(false);
  }

  if (!visible) {
    return null;
  }

  return (
    <div className="w-full border-y border-white/10 bg-zinc-950 text-white">
      <div className="container mx-auto flex min-h-11 flex-col items-center justify-center gap-3 px-4 py-2 text-center text-sm sm:flex-row sm:text-left">
        <span className="text-gray-200">Ta strona jest dostępna po polsku.</span>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={choosePolish}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-gray-200"
          >
            Przełącz na polski
          </button>
          <button
            type="button"
            onClick={stayEnglish}
            className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:border-white/30 hover:text-white"
          >
            Zostań przy angielskim
          </button>
        </div>
      </div>
    </div>
  );
}
