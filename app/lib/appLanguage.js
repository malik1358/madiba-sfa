"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { getSupabaseClient } from "./supabase";

const STORAGE_KEY = "madiba-language";
export const APP_LANGUAGE_EVENT = "madiba-language-change";

const AppLanguageContext = createContext(null);

export function readStoredLanguage() {
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

function subscribeToLanguageChanges(onStoreChange) {
  if (typeof window === "undefined") return () => {};

  function handleLanguageChange() {
    onStoreChange();
  }

  function handleStorage(event) {
    if (event.key === STORAGE_KEY) {
      onStoreChange();
    }
  }

  window.addEventListener(APP_LANGUAGE_EVENT, handleLanguageChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(APP_LANGUAGE_EVENT, handleLanguageChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function AppLanguageProvider({ children }) {
  const language = useSyncExternalStore(
    subscribeToLanguageChanges,
    readStoredLanguage,
    () => "en",
  );

  useEffect(() => {
    applyDocumentLanguage(language);
  }, [language]);

  const setLanguage = useCallback(async (nextLanguage) => {
    const next = nextLanguage === "ar" ? "ar" : "en";
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

  const value = useMemo(
    () => ({
      language,
      ar: language === "ar",
      dir: language === "ar" ? "rtl" : "ltr",
      setLanguage,
    }),
    [language, setLanguage],
  );

  return (
    <AppLanguageContext.Provider value={value}>
      {children}
    </AppLanguageContext.Provider>
  );
}

export function useAppLanguage() {
  const context = useContext(AppLanguageContext);
  if (context) return context;

  return {
    language: "en",
    ar: false,
    dir: "ltr",
    setLanguage: async () => {},
  };
}

export function translate(language, dictionary) {
  return function t(key) {
    const entry = dictionary[key];
    if (!entry) return key;
    return entry[language] || entry.en || key;
  };
}
