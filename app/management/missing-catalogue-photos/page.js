"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import ExportableTable from "../../components/ExportableTable";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import { getSupabaseClient } from "../../lib/supabase";

const TEXT = {
  title: { en: "Missing Catalogue Photos", ar: "صور الكتالوج الناقصة" },
  subtitle: {
    en: "Items with no catalogue photo. Building materials and do-not-use names are excluded.",
    ar: "أصناف بلا صورة في الكتالوج. مواد البناء والأسماء الملغاة مستثناة.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  loading: { en: "Loading items...", ar: "جاري تحميل الأصناف..." },
  refresh: { en: "Refresh", ar: "تحديث" },
  code: { en: "Code", ar: "الكود" },
  item: { en: "Item", ar: "الصنف" },
  category: { en: "Category", ar: "الفئة" },
  catalogue: { en: "Catalogue", ar: "الكتالوج" },
  priced: { en: "Priced", ar: "له سعر" },
  unpriced: { en: "No price", ar: "بدون سعر" },
  total: { en: "Total", ar: "الإجمالي" },
  pricedMissing: { en: "Priced, no photo", ar: "له سعر وبدون صورة" },
  unpricedMissing: { en: "No price, no photo", ar: "بدون سعر وبدون صورة" },
  withPhotos: { en: "Already have photos", ar: "لها صور" },
  excluded: { en: "Building materials excluded", ar: "مواد البناء المستثناة" },
  noRows: { en: "Every included item already has a photo.", ar: "كل الأصناف المشمولة لها صورة." },
  accessDenied: { en: "Only admin, manager, or invoice maker can open this report.", ar: "هذا التقرير للمدير أو الأدمن أو معد الفواتير." },
  signIn: { en: "Please login again.", ar: "يرجى تسجيل الدخول مرة أخرى." },
  photosNotReady: { en: "Photo storage is not ready, so every item is listed as missing.", ar: "تخزين الصور غير جاهز، لذلك تظهر كل الأصناف بلا صورة." },
};

export default function MissingCataloguePhotosPage() {
  const { language, dir, setLanguage } = useAppLanguage();
  const t = translate(language, TEXT);
  const supabaseClient = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [photosReady, setPhotosReady] = useState(true);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const supabase = getSupabaseClient();
      const session = await resolveAuthSession(supabase);
      const token = session?.access_token || "";
      if (!token) {
        setSignedOut(true);
        return;
      }
      setSignedOut(false);
      const response = await fetch("/api/missing-catalogue-photos", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (response.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load the report.");
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setSummary(payload.summary || null);
      setPhotosReady(payload.photosReady !== false);
    } catch (err) {
      setError(err.message || "Unable to load the report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Missing catalogue photos unavailable"
        message="Supabase credentials are required for this report."
      />
    );
  }

  if (signedOut || accessDenied) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <p className="moduleHint">{signedOut ? t("signIn") : t("accessDenied")}</p>
        </div>
      </main>
    );
  }

  return (
    <MorningAttendanceGate requireMorningAttendance={false}>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>{t("title")}</h2>
              <span>{summary?.missing || 0}</span>
              <button type="button" className="moduleInlineButton" onClick={loadReport}>{t("refresh")}</button>
            </div>
            {summary && (
              <p className="moduleHint">
                {t("pricedMissing")}: {summary.pricedMissing} · {t("unpricedMissing")}: {summary.unpricedMissing} · {t("withPhotos")}: {summary.withPhotos} · {t("excluded")}: {summary.excludedBuilding}
              </p>
            )}
            {!photosReady && <p className="moduleHint">{t("photosNotReady")}</p>}
            {error && <p className="moduleHint">{error}</p>}
            {loading ? (
              <div className="moduleLoading">{t("loading")}</div>
            ) : rows.length === 0 ? (
              <div className="moduleHint">{t("noRows")}</div>
            ) : (
              <ExportableTable filename="missing-catalogue-photos" sheetName="Missing photos" className="moduleTableWrap">
                <table className="moduleTable">
                  <thead>
                    <tr>
                      <th>{t("code")}</th>
                      <th>{t("item")}</th>
                      <th>{t("category")}</th>
                      <th>{t("catalogue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.code}>
                        <td>{row.code}</td>
                        <td>{row.name}</td>
                        <td>{row.category}</td>
                        <td>{row.priced ? t("priced") : t("unpriced")}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="modulePendingOrdersTotalRow">
                      <td>{t("total")}</td>
                      <td>{rows.length}</td>
                      <td />
                      <td>{summary?.pricedMissing || 0}</td>
                    </tr>
                  </tfoot>
                </table>
              </ExportableTable>
            )}
          </section>
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
