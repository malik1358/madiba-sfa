"use client";

import { useState } from "react";

export default function LoginPage() {
  const [language, setLanguage] = useState("en");

  const ar = language === "ar";

  return (
    <main className="loginPage" dir={ar ? "rtl" : "ltr"}>
      <div className="loginCard">

        <div className="brand">
          <div className="logo">M</div>

          <div>
            <h1>MADIBA</h1>
            <p>{ar ? "نظام إدارة المبيعات" : "Sales Force Automation"}</p>
          </div>
        </div>

        <div className="languageSelector">
          <button
            className={language === "en" ? "active" : ""}
            onClick={() => setLanguage("en")}
          >
            English
          </button>

          <button
            className={language === "ar" ? "active" : ""}
            onClick={() => setLanguage("ar")}
          >
            العربية
          </button>
        </div>

        <div className="welcome">
          <h2>{ar ? "مرحباً بك" : "Welcome back"}</h2>

          <p>
            {ar
              ? "سجل الدخول إلى حساب المبيعات الخاص بك"
              : "Sign in to your sales account"}
          </p>
        </div>

        <form>
          <label>{ar ? "البريد الإلكتروني" : "Email"}</label>

          <input
            type="email"
            placeholder={ar ? "أدخل البريد الإلكتروني" : "Enter your email"}
          />

          <label>{ar ? "كلمة المرور" : "Password"}</label>

          <input
            type="password"
            placeholder={ar ? "أدخل كلمة المرور" : "Enter your password"}
          />

          <button className="loginButton" type="submit">
            {ar ? "تسجيل الدخول" : "Sign In"}
          </button>
        </form>

        <div className="footer">
          MADIBA KSA
        </div>

      </div>
    </main>
  );
}
