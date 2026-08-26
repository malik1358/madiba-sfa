"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "./supabase";

const STORAGE_KEY = "madiba-language";
export const APP_LANGUAGE_EVENT = "madiba-language-change";

function readStoredLanguage() {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "ar" ? "ar" : "en";
}

function applyDocumentLanguage(language) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, language);
  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.body.dir = language === "ar" ? "rtl" : "ltr";
}

export function useAppLanguage() {
  const [language, setLanguageState] = useState("en");

  useEffect(() => {
    const stored = readStoredLanguage();
    setLanguageState(stored);
    applyDocumentLanguage(stored);

    function handleLanguageChange(event) {
      const next = event?.detail?.language;
      if (next === "ar" || next === "en") {
        setLanguageState(next);
      }
    }

    window.addEventListener(APP_LANGUAGE_EVENT, handleLanguageChange);
    return () => window.removeEventListener(APP_LANGUAGE_EVENT, handleLanguageChange);
  }, []);

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  const setLanguage = useCallback(async (nextLanguage) => {
    const next = nextLanguage === "ar" ? "ar" : "en";
    setLanguageState(next);
    applyDocumentLanguage(next);
    window.dispatchEvent(new CustomEvent(APP_LANGUAGE_EVENT, { detail: { language: next } }));

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user?.id) return;

    await supabase
      .from("profiles")
      .update({ preferred_language: next })
      .eq("id", session.user.id);
  }, []);

  return {
    language,
    ar: language === "ar",
    dir: language === "ar" ? "rtl" : "ltr",
    setLanguage,
  };
}

export function translate(language, dictionary) {
  return function t(key) {
    const entry = dictionary[key];
    if (!entry) return key;
    return entry[language] || entry.en || key;
  };
}