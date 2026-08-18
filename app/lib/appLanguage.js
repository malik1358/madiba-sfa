"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "./supabase";

const STORAGE_KEY = "madiba-language";

export function useAppLanguage() {
  const [language, setLanguageState] = useState("en");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") {
      setLanguageState(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.body.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  const setLanguage = useCallback(async (nextLanguage) => {
    const next = nextLanguage === "ar" ? "ar" : "en";
    setLanguageState(next);

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