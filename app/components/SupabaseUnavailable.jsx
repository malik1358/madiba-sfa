"use client";

import { useAppLanguage } from "../lib/appLanguage";

export default function SupabaseUnavailable({ title = "Supabase unavailable", message = "This app is currently missing its Supabase configuration." }) {
  const { dir } = useAppLanguage();
  return (
    <main className="loginPage" dir={dir}>
      <div className="loginCard" style={{ maxWidth: 480 }}>
        <div className="loadingText" style={{ textAlign: "left" }}>
          <h2 style={{ marginBottom: "8px" }}>{title}</h2>
          <p style={{ margin: 0, lineHeight: 1.6 }}>{message}</p>
        </div>
      </div>
    </main>
  );
}
