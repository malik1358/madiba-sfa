"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { COLLECTION_REMARK_IMPORT_OUTCOMES } from "../../lib/collectionRemarkImport";
import { getSupabaseClient } from "../../lib/supabase";
import { useModuleAccess } from "../../hooks/useModuleAccess";

const TEXT = {
  title: { en: "Import Collection Remarks", ar: "استيراد ملاحظات التحصيل" },
  back: { en: "Management", ar: "الإدارة" },
  intro: {
    en: "Upload a Stale Overdue Collections screenshot (or paste the table). Review the extracted remarks, then save them as FAR office collection visits so they show on the Stale Overdue Remarks column without clearing the near-visit filter.",
    ar: "ارفع لقطة شاشة لتقرير المتأخرات أو الصق الجدول. راجع الملاحظات ثم احفظها كزيارات تحصيل مكتبية (FAR) لتظهر في عمود الملاحظات دون إلغاء فلتر الزيارة القريبة.",
  },
  screenshot: { en: "Screenshot", ar: "لقطة الشاشة" },
  paste: { en: "Or paste table text", ar: "أو الصق نص الجدول" },
  pasteHint: {
    en: "TSV / CSV with Customer and Remarks columns works best if OCR misses rows.",
    ar: "الأفضل لصق جدول بأعمدة العميل والملاحظات إذا أخفق التعرف الضوئي.",
  },
  parse: { en: "Extract remarks", ar: "استخراج الملاحظات" },
  parsing: { en: "Reading screenshot…", ar: "جاري قراءة اللقطة…" },
  commit: { en: "Save FAR collection visits", ar: "حفظ زيارات التحصيل (FAR)" },
  committing: { en: "Saving…", ar: "جاري الحفظ…" },
  clear: { en: "Clear", ar: "مسح" },
  selectAll: { en: "Select all", ar: "تحديد الكل" },
  selectNone: { en: "Select none", ar: "إلغاء التحديد" },
  customer: { en: "Customer", ar: "العميل" },
  remark: { en: "Collection comment", ar: "ملاحظة التحصيل" },
  outcome: { en: "Outcome", ar: "النتيجة" },
  exists: { en: "In master", ar: "في السجل" },
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "Missing", ar: "غير موجود" },
  selected: { en: "Selected", ar: "المحدد" },
  rows: { en: "rows", ar: "صفوف" },
  denied: {
    en: "Only admin or manager can import collection remarks.",
    ar: "استيراد ملاحظات التحصيل متاح للأدمن والمدير فقط.",
  },
  login: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  noRows: {
    en: "No customer remarks found. Try a clearer screenshot or paste the Remarks column.",
    ar: "لم يتم العثور على ملاحظات. جرّب لقطة أوضح أو الصق عمود الملاحظات.",
  },
  saved: { en: "Saved FAR visits", ar: "تم حفظ زيارات FAR" },
  parseError: { en: "Unable to extract remarks.", ar: "تعذر استخراج الملاحظات." },
  commitError: { en: "Unable to save visits.", ar: "تعذر حفظ الزيارات." },
  farNote: {
    en: "Visits are saved at the MADIBA store GPS (FAR) under your login.",
    ar: "تُحفظ الزيارات بإحداثيات متجر ماديبا (FAR) باسم حسابك.",
  },
};

export default function CollectionRemarkImportPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabase = getSupabaseClient();
  const { access, loading: accessLoading } = useModuleAccess();
  const canAccess = access?.canAccess?.("collectionRemarkImport");

  const [file, setFile] = useState(null);
  const [pastedText, setPastedText] = useState("");
  const [rows, setRows] = useState([]);
  const [ocrPreview, setOcrPreview] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedCount = useMemo(
    () => rows.filter((row) => row.selected && row.customerCode && row.remark).length,
    [rows],
  );

  async function authHeaders() {
    const session = await resolveAuthSession(supabase);
    if (!session?.access_token) throw new Error(t("login"));
    return { Authorization: `Bearer ${session.access_token}` };
  }

  async function handleParse(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setBusy("parse");
    try {
      const headers = await authHeaders();
      const form = new FormData();
      form.set("action", "parse");
      if (pastedText.trim()) form.set("text", pastedText);
      if (file) form.set("file", file);
      const response = await fetch("/api/collection-remark-import", {
        method: "POST",
        headers,
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || t("parseError"));
      }
      setRows((payload.rows || []).map((row, index) => ({
        ...row,
        id: row.id || `${row.customerCode}-${index}`,
        selected: row.customerExists !== false,
      })));
      setOcrPreview(String(payload.ocrText || "").trim());
      if (!(payload.rows || []).length) setError(t("noRows"));
    } catch (err) {
      setRows([]);
      setError(err?.message || t("parseError"));
    } finally {
      setBusy("");
    }
  }

  async function handleCommit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setBusy("commit");
    try {
      const headers = await authHeaders();
      const response = await fetch("/api/collection-remark-import", {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "commit",
          rows: rows.filter((row) => row.selected),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || t("commitError"));
      }
      setSuccess(`${t("saved")}: ${payload.savedCount}`);
      setRows((prev) => prev.map((row) => (
        row.selected
          ? { ...row, selected: false, saved: true }
          : row
      )));
    } catch (err) {
      setError(err?.message || t("commitError"));
    } finally {
      setBusy("");
    }
  }

  function updateRow(id, patch) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  if (accessLoading) {
    return (
      <MorningAttendanceGate requireMorningAttendance={false}>
        <main className="modulePage" dir={dir}>
          <p className="moduleMuted">…</p>
        </main>
      </MorningAttendanceGate>
    );
  }

  if (!canAccess) {
    return (
      <MorningAttendanceGate requireMorningAttendance={false}>
        <main className="modulePage" dir={dir}>
          <p className="moduleError">{t("denied")}</p>
          <Link href="/management">{t("back")}</Link>
        </main>
      </MorningAttendanceGate>
    );
  }

  return (
    <MorningAttendanceGate requireMorningAttendance={false}>
      <main className="modulePage" dir={dir}>
        <header className="moduleHeader">
          <div>
            <p className="moduleEyebrow">
              <Link href="/management">{t("back")}</Link>
            </p>
            <h1>{t("title")}</h1>
            <p className="moduleMuted" style={{ maxWidth: 720 }}>{t("intro")}</p>
            <p className="moduleMuted">{t("farNote")}</p>
          </div>
          <AppLanguageSwitch language={language} setLanguage={setLanguage} />
        </header>

        <form className="moduleCard" onSubmit={handleParse} style={{ display: "grid", gap: 12, marginBottom: 16 }}>
          <label className="moduleField">
            <span>{t("screenshot")}</span>
            <input
              type="file"
              accept="image/*,.png,.jpg,.jpeg,.webp"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <label className="moduleField">
            <span>{t("paste")}</span>
            <textarea
              rows={5}
              value={pastedText}
              onChange={(event) => setPastedText(event.target.value)}
              placeholder={"Customer\tRemarks\n1054C\tcase is currently with court…"}
              style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 13 }}
            />
            <small className="moduleMuted">{t("pasteHint")}</small>
          </label>
          <div className="moduleActionRow" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" className="modulePrimaryButton" disabled={Boolean(busy)}>
              {busy === "parse" ? t("parsing") : t("parse")}
            </button>
            <button
              type="button"
              className="moduleInlineButton"
              disabled={Boolean(busy)}
              onClick={() => {
                setFile(null);
                setPastedText("");
                setRows([]);
                setOcrPreview("");
                setError("");
                setSuccess("");
              }}
            >
              {t("clear")}
            </button>
          </div>
        </form>

        {error ? <p className="moduleError">{error}</p> : null}
        {success ? <p className="moduleSuccess">{success}</p> : null}

        {rows.length ? (
          <section className="moduleCard" style={{ display: "grid", gap: 12 }}>
            <div className="moduleActionRow" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <strong>{selectedCount} / {rows.length} {t("rows")}</strong>
              <button type="button" className="moduleInlineButton" onClick={() => setRows((prev) => prev.map((row) => ({ ...row, selected: true })))}>
                {t("selectAll")}
              </button>
              <button type="button" className="moduleInlineButton" onClick={() => setRows((prev) => prev.map((row) => ({ ...row, selected: false })))}>
                {t("selectNone")}
              </button>
              <button
                type="button"
                className="modulePrimaryButton"
                disabled={Boolean(busy) || selectedCount === 0}
                onClick={handleCommit}
              >
                {busy === "commit" ? t("committing") : t("commit")}
              </button>
            </div>

            <div className="moduleTableWrap">
              <table className="moduleTable">
                <thead>
                  <tr>
                    <th>{t("selected")}</th>
                    <th>{t("customer")}</th>
                    <th>{t("exists")}</th>
                    <th>{t("outcome")}</th>
                    <th>{t("remark")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.id} className={index % 2 ? "moduleTableRowAlt" : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(row.selected)}
                          disabled={row.saved || row.customerExists === false}
                          onChange={(event) => updateRow(row.id, { selected: event.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          value={row.customerCode}
                          onChange={(event) => updateRow(row.id, { customerCode: event.target.value.toUpperCase() })}
                          style={{ width: 90 }}
                          disabled={row.saved}
                        />
                      </td>
                      <td style={{ color: row.customerExists === false ? "#b91c1c" : "#15803d" }}>
                        {row.customerExists === false ? t("no") : t("yes")}
                      </td>
                      <td>
                        <select
                          value={row.visitOutcome}
                          disabled={row.saved}
                          onChange={(event) => updateRow(row.id, { visitOutcome: event.target.value })}
                        >
                          {COLLECTION_REMARK_IMPORT_OUTCOMES.map((outcome) => (
                            <option key={outcome} value={outcome}>{outcome}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <textarea
                          rows={2}
                          value={row.remark}
                          disabled={row.saved}
                          onChange={(event) => updateRow(row.id, { remark: event.target.value })}
                          style={{ width: "100%", minWidth: 220, color: "#b91c1c" }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {ocrPreview ? (
          <details className="moduleCard" style={{ marginTop: 16 }}>
            <summary>OCR text</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{ocrPreview}</pre>
          </details>
        ) : null}
      </main>
    </MorningAttendanceGate>
  );
}
