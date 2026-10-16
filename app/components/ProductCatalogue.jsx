"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppPopup } from "./AppPopupProvider";
import { fetchJsonWithTimeout, getSessionWithTimeout } from "../lib/authSession";
import { buildCatalogueShareFiles } from "../lib/catalogueShareCanvas";
import {
  buildCatalogueShareLines, CATALOGUE_CAROUSEL_MS, catalogueShareLatinWords, catalogueShareTextFromDictionary,
  catalogueShareUnknownWords, nextCataloguePhotoIndex, translateCatalogueShareText,
} from "../lib/catalogueShareCard";
import { getSupabaseClient } from "../lib/supabase";
import {
  catalogueCardPrice, catalogueItemGroups, hasCataloguePrice, normalizeCatalogueCode, validateCataloguePhoto,
} from "../lib/productCatalogue";
import { formatMoneyAmount, pricingRegionLabel } from "../lib/regionalPricing";
import { shareTextAndFilesOnWhatsapp } from "../lib/whatsappShare";
import { downloadStoredZip } from "../lib/zipStoredFiles";
import styles from "./ProductCatalogue.module.css";

const PAGE_SIZE = 24;

function PhotoCarousel({ photos, name, language, onRemove, busy }) {
  const [index, setIndex] = useState(0);
  const [failedUrl, setFailedUrl] = useState("");
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const [timerGeneration, setTimerGeneration] = useState(0);
  const frameRef = useRef(null);
  const photoKey = photos.map((photo) => photo.id).join("|");
  const current = photos[index % Math.max(photos.length, 1)];
  const ar = language === "ar";

  useEffect(() => {
    setIndex((value) => (photos.length ? value % photos.length : 0));
  }, [photoKey, photos.length]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (photos.length < 2 || paused || !inView) return undefined;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const timer = window.setInterval(() => {
      setIndex((value) => nextCataloguePhotoIndex(value, photos.length));
    }, CATALOGUE_CAROUSEL_MS);
    return () => window.clearInterval(timer);
  }, [photos.length, paused, inView, timerGeneration]);

  return (
    <div
      ref={frameRef}
      className={styles.gallery}
      aria-label={`${ar ? "صور" : "Photos"}: ${name}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
    >
      {current && failedUrl !== current.url ? (
        <img key={current.url} src={current.url} alt={name} loading="lazy" onError={() => setFailedUrl(current.url)} />
      ) : (
        <div className={styles.placeholder}>
          <svg width="52" height="52" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect x="5" y="8" width="38" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
            <circle cx="16" cy="18" r="4" stroke="currentColor" strokeWidth="2" />
            <path d="m6 35 11-10 8 7 8-13 10 16" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span>{current ? (ar ? "تعذر عرض الصورة. حدّث الصور." : "Photo unavailable. Refresh photos.") : (ar ? "لا توجد صورة بعد" : "No photo yet")}</span>
        </div>
      )}
      {photos.length > 1 && (
        <div className={styles.carouselControls}>
          <button type="button" aria-label={ar ? "الصورة السابقة" : "Previous photo"} onClick={() => { setTimerGeneration((value) => value + 1); setIndex((value) => (value - 1 + photos.length) % photos.length); }}>&lt;</button>
          <span>{index % photos.length + 1} / {photos.length}</span>
          <button type="button" aria-label={ar ? "الصورة التالية" : "Next photo"} onClick={() => { setTimerGeneration((value) => value + 1); setIndex((value) => (value + 1) % photos.length); }}>&gt;</button>
        </div>
      )}
      {current && onRemove && (
        <button type="button" className={styles.removePhoto} disabled={busy} onClick={() => onRemove(current.id)}>{ar ? "حذف الصورة" : "Remove photo"}</button>
      )}
    </div>
  );
}

export default function ProductCatalogue({
  items, categories, search, onSearch, category, onCategory, quantities,
  onQty, onIncrease, onDecrease, priceList, pricingRegion, language,
  selectedCustomer, customerSearch, onCustomerSearch, customerSuggestions, onCustomer,
  orderTotal, selectedCount, orderLines,
  pricingType, onPricingType, allowedPricingRegions, onPricingRegion, retailAvailable,
  nearestCustomers,
  paymentType, onPaymentType, cashDiscountMap, valueDiscountMap, schemeApplications,
  newItems, historyLoading, historyReady,
}) {
  const ar = language === "ar";
  const { showPopup } = useAppPopup();
  const [details, setDetails] = useState({});
  const [warnings, setWarnings] = useState([]);
  const [canManagePhotos, setCanManagePhotos] = useState(false);
  const [photosReady, setPhotosReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [sharingCode, setSharingCode] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [page, setPage] = useState(0);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const writeInFlight = useRef(false);
  const mounted = useRef(false);

  const request = useCallback(async (url = "/api/product-catalogue", options = {}) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase is not configured.");
    const session = await getSessionWithTimeout(supabase);
    if (!session?.access_token) throw new Error("Please login again.");
    const { response, payload } = await fetchJsonWithTimeout(url, {
      ...options, headers: { Authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) },
    }, 45000);
    if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load product photos.");
    return payload;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await request();
      if (!mounted.current) return;
      setDetails(payload.details);
      setWarnings(payload.warnings || []);
      setCanManagePhotos(payload.canManagePhotos === true);
      setPhotosReady(payload.photosReady === true);
    } catch (err) {
      if (mounted.current) setError(err.message || "Unable to load photos and packing.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    // Signed attachment URLs expire in about five minutes; refresh before then.
    const timer = setInterval(() => { void refresh(); }, 4 * 60 * 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => { setPage(0); }, [search, category, pricingRegion, pricingType, selectedCustomer?.customer_code]);

  async function upload(itemCode, file) {
    if (!file || !canManagePhotos || writeInFlight.current) return;
    setError("");
    try {
      validateCataloguePhoto(file);
    } catch (err) {
      setError(err.message || "Unable to upload this photo.");
      return;
    }
    writeInFlight.current = true;
    setBusy(itemCode);
    try {
      const form = new FormData();
      form.set("itemCode", itemCode);
      form.set("photo", file);
      await request("/api/product-catalogue", { method: "POST", body: form });
      await refresh();
    } catch (err) {
      setError(err.message || "Photo upload failed.");
    } finally {
      writeInFlight.current = false;
      setBusy("");
    }
  }

  async function remove(itemCode, photoId) {
    if (!canManagePhotos || writeInFlight.current) return;
    const choice = await showPopup({
      variant: "warning",
      message: ar ? "حذف هذه الصورة من كتالوج المنتجات؟" : "Remove this photo from the product catalogue?",
      choices: [{ id: "cancel", label: ar ? "إلغاء" : "Cancel" }, { id: "remove", label: ar ? "حذف" : "Remove" }],
    });
    if (choice !== "remove" || writeInFlight.current) return;
    writeInFlight.current = true;
    setBusy(itemCode);
    setError("");
    try {
      await request(`/api/product-catalogue?photoId=${encodeURIComponent(photoId)}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err.message || "Unable to remove photo.");
    } finally {
      writeInFlight.current = false;
      setBusy("");
    }
  }

  async function catalogueAccessToken() {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error(ar ? "الإعداد غير مكتمل." : "Supabase is not configured.");
    const session = await getSessionWithTimeout(supabase);
    if (!session?.access_token) throw new Error(ar ? "يرجى تسجيل الدخول مرة أخرى." : "Please login again.");
    return session.access_token;
  }

  async function loadSharePhoto(photo, accessToken) {
    const token = accessToken || await catalogueAccessToken();
    const response = await fetch(`/api/product-catalogue?photoId=${encodeURIComponent(photo.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(ar ? "تعذر تحميل صورة المنتج." : "Unable to load the product photo.");
    return response.blob();
  }

  async function mapWithLimit(list, limit, worker) {
    const results = new Array(list.length);
    let cursor = 0;
    async function run() {
      while (cursor < list.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(list[index], index);
      }
    }
    const workers = Math.min(Math.max(limit, 1), list.length || 1);
    await Promise.all(Array.from({ length: workers }, () => run()));
    return results;
  }

  async function translateSharePhrase(phrase) {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: phrase, from: "en", to: "ar" }),
      signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) return "";
    return String(payload.translatedText || "").trim();
  }

  function pricedShareFields(item, includePrice) {
    const price = Number(priceList[item.item_code]);
    const hasPrice = hasCataloguePrice(price);
    const qty = Number(quantities[item.item_code] || 0);
    const priced = catalogueCardPrice(item, {
      price, quantity: qty, paymentType, cashDiscountMap, valueDiscountMap, schemeApplications,
    });
    const discounted = hasPrice && priced.rate < price - 0.000001;
    return {
      priceAmount: includePrice && hasPrice ? formatMoneyAmount(priced.rate) : "",
      originalAmount: includePrice && discounted ? formatMoneyAmount(price) : "",
      cashDiscount: includePrice && discounted && priced.applied.cash,
      valueDiscount: includePrice && discounted && priced.applied.value,
      schemeDiscount: includePrice && discounted && priced.applied.scheme,
    };
  }

  async function shareLines(item, detail, includePrice, translate = translateSharePhrase) {
    const [nameArabic, packingArabic, unitArabic] = await Promise.all([
      translateCatalogueShareText(item.item_name, translate),
      translateCatalogueShareText(detail.packing, translate),
      translateCatalogueShareText(detail.sellingUnit, translate),
    ]);
    return buildCatalogueShareLines({
      name: item.item_name,
      nameArabic,
      code: item.item_code,
      packing: detail.packing,
      packingArabic,
      sellingUnit: detail.sellingUnit,
      unitArabic,
      includePrice,
      ...pricedShareFields(item, includePrice),
      pricingType,
      region: pricingRegion,
    });
  }

  function itemDetail(item) {
    return details[item.item_code] || details[normalizeCatalogueCode(item.item_code)] || {};
  }

  async function shareItem(item, detail) {
    if (sharingCode || exporting) return;
    setSharingCode(item.item_code);
    setError("");
    let notice = null;
    try {
      const lines = await shareLines(item, detail, true);
      const dialogTitle = ar ? "مشاركة على واتساب" : "Share on WhatsApp";
      const token = await catalogueAccessToken();
      const files = await buildCatalogueShareFiles({
        photos: detail.photos || [],
        lines,
        loadPhoto: (photo) => loadSharePhoto(photo, token),
        fileCode: item.item_code,
      });
      const result = await shareTextAndFilesOnWhatsapp("", files, { title: item.item_name, dialogTitle });
      if (result.success || result.reason === "cancelled") return;
      notice = {
        variant: "info",
        message: ar
          ? "الصورة جاهزة وفيها التفاصيل بالإنجليزية والعربية. اضغط مشاركة على واتساب. لن يُرسل نص منفصل."
          : "The photo is ready with the details in English and Arabic. Tap Share on WhatsApp. No separate text is sent.",
        whatsappFiles: files,
      };
    } catch (err) {
      notice = {
        variant: "error",
        message: err.message || (ar ? "تعذر تجهيز صورة المشاركة." : "Unable to prepare the share image."),
      };
    } finally {
      setSharingCode("");
    }
    if (notice) await showPopup(notice);
  }

  const { recommended: recommendedItems, browse: browseItems } = catalogueItemGroups(items, newItems, historyReady);
  const exportItems = [...(historyReady ? recommendedItems : []), ...browseItems];
  const unpricedCartCodes = Object.keys(quantities).filter((code) => Number(quantities[code]) > 0 && !hasCataloguePrice(priceList[code]));
  const lastPage = Math.max(0, Math.ceil(browseItems.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = browseItems.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const groups = [
    ...(historyReady ? [{ key: "new", items: recommendedItems }] : []),
    { key: "all", items: visible },
  ];

  async function exportCatalogue() {
    if (!exportItems.length || exporting || sharingCode) return;
    const choice = await showPopup({
      title: ar ? "تصدير الكتالوج" : "Export catalogue",
      message: ar
        ? `تجهيز صور كل المنتجات المطابقة للفلاتر الحالية (${exportItems.length})؟`
        : `Prepare the same item photos for all ${exportItems.length} products matching the current filters?`,
      choices: [
        { id: "cancel", label: ar ? "إلغاء" : "Cancel" },
        { id: "without", label: ar ? "بدون السعر" : "Without price" },
        { id: "yes", label: ar ? "مع السعر" : "With price" },
      ],
    });
    if (choice !== "yes" && choice !== "without") return;
    const includePrice = choice === "yes";
    setExporting(true);
    setExportProgress(ar ? "جاري الترجمة" : "Translating");
    setError("");
    const files = [];
    const skipped = [];
    let notice = null;
    try {
      const dictionary = new Map();
      const unknownWords = catalogueShareUnknownWords(exportItems.flatMap((item) => {
        const detail = itemDetail(item);
        return [item.item_name, detail.packing, detail.sellingUnit];
      }));
      let translatedCount = 0;
      await mapWithLimit(unknownWords, 6, async (word) => {
        const translated = await translateSharePhrase(word);
        if (translated && catalogueShareLatinWords(translated).length === 0) dictionary.set(word, translated);
        translatedCount += 1;
        setExportProgress(ar
          ? `ترجمة ${translatedCount} / ${unknownWords.length}`
          : `Translating ${translatedCount} / ${unknownWords.length}`);
      });
      const token = await catalogueAccessToken();
      let prepared = 0;
      const batches = await mapWithLimit(exportItems, 4, async (item) => {
        try {
          const detail = itemDetail(item);
          const lines = buildCatalogueShareLines({
            name: item.item_name,
            nameArabic: catalogueShareTextFromDictionary(item.item_name, dictionary),
            code: item.item_code,
            packing: detail.packing,
            packingArabic: catalogueShareTextFromDictionary(detail.packing, dictionary),
            sellingUnit: detail.sellingUnit,
            unitArabic: catalogueShareTextFromDictionary(detail.sellingUnit, dictionary),
            includePrice,
            ...pricedShareFields(item, includePrice),
            pricingType,
            region: pricingRegion,
          });
          const itemFiles = await buildCatalogueShareFiles({
            photos: detail.photos || [],
            lines,
            loadPhoto: (photo) => loadSharePhoto(photo, token),
            fileCode: item.item_code,
          });
          prepared += 1;
          setExportProgress(ar
            ? `الصور ${prepared} / ${exportItems.length}`
            : `Photos ${prepared} / ${exportItems.length}`);
          return itemFiles;
        } catch {
          skipped.push(item.item_code);
          prepared += 1;
          setExportProgress(ar
            ? `الصور ${prepared} / ${exportItems.length}`
            : `Photos ${prepared} / ${exportItems.length}`);
          return [];
        }
      });
      files.push(...batches.flat());
      if (!files.length) throw new Error(ar ? "تعذر تجهيز صور المنتجات." : "Unable to prepare the product photos.");
      const dialogTitle = ar ? "مشاركة صور الكتالوج" : "Share catalogue photos";
      const result = await shareTextAndFilesOnWhatsapp("", files, {
        title: ar ? "كتالوج المنتجات" : "Product catalogue",
        dialogTitle,
      });
      if (!(result.success || result.reason === "cancelled")) {
        await downloadStoredZip(files, `product-catalogue-${pricingRegion}${includePrice ? "" : "-no-price"}`);
        notice = {
          variant: "info",
          message: ar
            ? "تعذر إرسال كل الصور دفعة واحدة على واتساب. تم تنزيل الصور معاً."
            : "WhatsApp could not take every photo at once. The photos were downloaded together.",
        };
      }
    } catch (err) {
      notice = {
        variant: "error",
        message: err.message || (ar ? "تعذر تجهيز صور الكتالوج." : "Unable to prepare the catalogue photos."),
      };
    } finally {
      setExporting(false);
      setExportProgress("");
    }
    if (skipped.length) {
      setError(ar
        ? `تعذر تجهيز: ${skipped.join(", ")}`
        : `Unable to prepare: ${skipped.join(", ")}`);
    }
    if (notice) await showPopup(notice);
  }

  return (
    <section className={`moduleSection ${styles.catalogue}`}>
      <div className="moduleSectionHeader">
        <h2>{ar ? "تصفح المنتجات" : "Shop the catalogue"}</h2>
        <span>{items.length} {ar ? "منتج" : "products"} · {pricingRegionLabel(pricingRegion)}</span>
      </div>
      {nearestCustomers}
      <div className={styles.customer}>
        <label htmlFor="catalogue-order-customer">{ar ? "العميل للطلب" : "Order customer"}</label>
        <div className="moduleCustomerSearch"
          onFocus={() => setCustomerSearchOpen(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setCustomerSearchOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setCustomerSearchOpen(false);
          }}>
          <input id="catalogue-order-customer" className="moduleInput" type="search"
            placeholder={ar ? "ابحث عن العميل بالرمز أو الاسم" : "Search customer by code or name"}
            value={customerSearch} autoComplete="off"
            onChange={(event) => {
              onCustomerSearch(event.target.value);
              setCustomerSearchOpen(true);
            }} />
          {customerSearchOpen && customerSearch.trim() && (
            <div className="moduleCustomerSuggestions">
              {customerSuggestions.map((customer) => (
                <button type="button" key={customer.customer_code} onClick={() => {
                  onCustomer(customer.customer_code, customer.customer_name);
                  setCustomerSearchOpen(false);
                }}>
                  <strong>{customer.customer_name}{customer.is_prospect ? (ar ? " (عميل محتمل)" : " (Prospect)") : ""}</strong>
                  <span>{customer.customer_code}</span>
                </button>
              ))}
              {customerSuggestions.length === 0 && <p role="status">{ar ? "لا يوجد عميل مطابق." : "No matching customers."}</p>}
            </div>
          )}
        </div>
        {selectedCustomer && <div className={styles.selectedCustomer}>
          <span>{ar ? "العميل المحدد:" : "Selected customer:"} {selectedCustomer.customer_code} - {selectedCustomer.customer_name}</span>
          <button type="button" className="moduleInlineButton" onClick={() => {
            onCustomer("");
            onCustomerSearch("");
            setCustomerSearchOpen(false);
          }}>{ar ? "مسح العميل" : "Clear customer"}</button>
        </div>}
      </div>
      <div className={styles.toolbar}>
        <label>{ar ? "طريقة الدفع" : "Payment type"}
          <select className="moduleInput" value={paymentType} onChange={(event) => onPaymentType(event.target.value)}>
            <option value="credit">{ar ? "آجل" : "Credit"}</option>
            <option value="cash">{ar ? "نقداً" : "Cash"}</option>
          </select>
        </label>
        <label>{ar ? "نوع التسعير" : "Pricing type"}
          <select className="moduleInput" value={pricingType} onChange={(event) => onPricingType(event.target.value)}>
            <option value="wholesale">{ar ? "الجملة" : "Wholesale"}</option>
            <option value="retail" disabled={!retailAvailable}>{ar ? "التجزئة" : "Retail"}</option>
          </select>
        </label>
        <label>{ar ? "مدينة التسعير" : "Pricing city"}
          <select className="moduleInput" value={pricingRegion} onChange={(event) => onPricingRegion(event.target.value)}>
            {allowedPricingRegions.map((region) => <option key={region} value={region}>{pricingRegionLabel(region)}</option>)}
          </select>
        </label>
        <label>{ar ? "البحث" : "Search"}
          <input className="moduleInput" placeholder={ar ? "رمز الصنف أو الاسم أو الفئة" : "Item code, name, or category"} value={search} onChange={(event) => onSearch(event.target.value)} />
        </label>
        <label>{ar ? "الفئة" : "Category"}
          <select className="moduleInput" value={category} onChange={(event) => onCategory(event.target.value)}>
            {categories.map((value) => <option key={value} value={value}>{value === "ALL" ? (ar ? "كل الفئات" : "All categories") : value}</option>)}
          </select>
        </label>
        <button type="button" className="moduleInlineButton" disabled={loading || Boolean(busy)} onClick={refresh}>{ar ? "تحديث الصور" : "Refresh photos"}</button>
        <button type="button" className="moduleInlineButton" disabled={loading || exporting || Boolean(sharingCode) || exportItems.length === 0} onClick={() => { void exportCatalogue(); }}>
          {exporting ? (exportProgress || (ar ? "جاري التجهيز" : "Preparing")) : (ar ? "تصدير" : "Export")}
        </button>
      </div>
      <p className="moduleHint">
        {ar ? "الأسعار قبل الضريبة. نوع التسعير والمدينة يطبقان على الطلب. الخصومات والعروض تحسب في مراجعة الطلب." : "Prices exclude VAT. Pricing type and city apply to your order. Cash discounts, value discounts, and schemes are calculated in the order review."}
      </p>
      {!retailAvailable && <p className={styles.notice}>{ar ? "أسعار التجزئة غير متاحة لهذه المدينة. أعد المحاولة بعد مزامنة الأسعار." : "Retail prices are unavailable for this city. Retry after price sync."}</p>}
      {unpricedCartCodes.length > 0 && <p role="alert" className={styles.error}>
        {ar ? "بعض أصناف الطلب ليس لها سعر في المدينة ونوع التسعير المحددين. غيّر التسعير أو احذفها من مراجعة الطلب:" : "Some cart items have no price for this city and pricing type. Change pricing or remove them in order review:"} {unpricedCartCodes.join(", ")}
      </p>}
      {canManagePhotos && <p className="moduleHint">{ar ? "ارفع صور JPEG أو PNG أو WebP، بحد أقصى 3 ميجابايت للصورة. يمكن إضافة أكثر من صورة للصنف." : "Upload JPEG, PNG, or WebP photos, up to 3 MB each. Add more than one photo per item for the carousel."}</p>}
      {canManagePhotos && !photosReady && <p className={styles.notice}>{ar ? "تخزين الصور غير جاهز بعد. طبّق ترحيل الصور في Supabase." : "Photo storage is not ready yet. Apply the product catalogue photos migration in Supabase."}</p>}
      {loading && <p role="status">{ar ? "جاري تحميل الصور والتعبئة..." : "Loading photos and packing..."}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {warnings.map((warning) => <p key={warning} className={styles.notice}>{warning}</p>)}
      {!selectedCustomer && <p className={styles.notice}><a href="#catalogue-customer">{ar ? "اختر العميل أدناه لإعداد الطلب." : "Choose a customer below to prepare an order."}</a> {ar ? "يمكنك تصفح جميع المنتجات الآن." : "You can browse all products now."}</p>}
      {selectedCustomer && historyLoading && <p role="status">{ar ? "جاري تحميل توصيات العميل..." : "Loading customer recommendations..."}</p>}
      {groups.map((group) => <section key={group.key}>
        {group.key === "new" ? <>
          <h3>{ar ? "أصناف جديدة" : "New Items"}</h3>
          <p className="moduleHint">{ar ? "أصناف لم يشترها هذا العميل من قبل" : "Items this customer has never bought"}</p>
          {group.items.length === 0 && <p>{ar ? "لا توجد توصيات مطابقة لهذه الفلاتر." : "No new item recommendations match these filters."}</p>}
        </> : <h3>{ar ? "جميع المنتجات" : "All products"}</h3>}
        <div className={styles.grid}>
        {group.items.map((item) => {
          const detail = details[item.item_code] || {};
          const qty = Number(quantities[item.item_code] || 0);
          const price = Number(priceList[item.item_code]);
          const hasPrice = hasCataloguePrice(price);
          const priced = catalogueCardPrice(item, {
            price, quantity: qty, paymentType, cashDiscountMap, valueDiscountMap, schemeApplications,
          });
          const discounted = priced.rate < price - 0.000001;
          const disabled = !selectedCustomer || !hasPrice;
          return (
            <article key={item.item_code} className={`${styles.card} ${qty > 0 ? styles.selected : ""}`}>
              <PhotoCarousel photos={detail.photos || []} name={item.item_name} language={language} busy={Boolean(busy)}
                onRemove={canManagePhotos ? (id) => remove(item.item_code, id) : undefined} />
              <div className={styles.cardBody}>
                <span className={styles.category}>{item.category}</span>
                <h3>{item.item_name}</h3>
                <div className="moduleCode">{item.item_code}</div>
                <p className={styles.packing}>
                  <strong>{ar ? "التعبئة" : "Packing"}:</strong> {detail.packing || (ar ? "حجم العبوة غير متوفر" : "Pack size not available")}
                  {detail.sellingUnit && <span><strong>{ar ? "وحدة البيع" : "Selling unit"}:</strong> {detail.sellingUnit}</span>}
                </p>
                <div className={styles.priceRow}>
                  {discounted && <del className={styles.originalPrice}>{formatMoneyAmount(price)} ﷼</del>}
                  <strong className={styles.price}>{hasPrice ? `${formatMoneyAmount(priced.rate)} ﷼` : (ar ? "السعر غير متوفر" : "Price unavailable")}</strong>
                </div>
                {discounted && <span className={styles.discountLabel}>
                  {[
                    priced.applied.cash && (ar ? "خصم نقدي" : "Cash discount"),
                    priced.applied.value && (ar ? "خصم الكمية" : "Volume discount"),
                    priced.applied.scheme && (ar ? "عرض" : "Scheme"),
                  ].filter(Boolean).join(" + ")}
                </span>}
                {hasPrice && detail.sellingUnit && <span className="moduleCode">{ar ? "لكل" : "per"} {detail.sellingUnit}</span>}
                <button
                  type="button"
                  className={styles.share}
                  disabled={Boolean(sharingCode) || Boolean(busy)}
                  onClick={() => { void shareItem(item, detail); }}
                >
                  {sharingCode === item.item_code
                    ? (ar ? "جاري تجهيز الصورة..." : "Preparing photo...")
                    : (ar ? "مشاركة واتساب" : "Share on WhatsApp")}
                </button>
                <div className={styles.qty}>
                  <button type="button" disabled={disabled || qty <= 0} aria-label={`${ar ? "تقليل" : "Decrease"} ${item.item_name}`} onClick={() => onDecrease(item.item_code)}>-</button>
                  <input type="number" min="0" step="1" disabled={disabled} aria-label={`${ar ? "الكمية" : "Quantity"} ${item.item_name}`} value={qty || ""}
                    onChange={(event) => onQty(item.item_code, event.target.value)} />
                  <button type="button" disabled={disabled} aria-label={`${ar ? "إضافة" : "Add"} ${item.item_name}`} onClick={() => onIncrease(item.item_code)}>+</button>
                </div>
                {canManagePhotos && (
                  <label className={styles.upload}>
                    {ar ? "رفع صورة" : "Upload photo"}
                    <input type="file" accept="image/jpeg,image/png,image/webp"
                      disabled={!photosReady || Boolean(busy)}
                      aria-label={`${ar ? "رفع صورة" : "Upload photo"} ${item.item_code}`}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        void upload(item.item_code, file);
                      }} />
                  </label>
                )}
              </div>
            </article>
          );
        })}
        </div>
      </section>)}
      {items.length === 0 && <p>{ar ? "لا توجد منتجات تطابق البحث." : "No products match these filters."}</p>}
      {lastPage > 0 && <div className={styles.pagination}>
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{ar ? "السابق" : "Previous"}</button>
        <span aria-live="polite">{currentPage + 1} / {lastPage + 1}</span>
        <button type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{ar ? "التالي" : "Next"}</button>
      </div>}
      <div className={styles.cart}>
        <div><strong>{selectedCount} {ar ? "صنف في الطلب" : "items in your order"}</strong><span>{formatMoneyAmount(orderTotal)} ﷼ {ar ? "شامل الضريبة" : "incl. VAT"}</span></div>
        <a className="modulePrimaryButton" href={selectedCustomer ? "#catalogue-order-review" : "#catalogue-customer"}>{ar ? "مراجعة الطلب" : "Review order"}</a>
      </div>
      {orderLines.length > 0 && <details className={styles.cartDetails}>
        <summary>{ar ? "الأصناف المختارة" : "Selected items"}</summary>
        {orderLines.map((line) => <div key={line.item_code}><span>{line.item_code} · {line.item_name}</span><strong>{quantities[line.item_code]} · {formatMoneyAmount(line.lineTotal)} ﷼</strong><button type="button" onClick={() => onQty(line.item_code, 0)}>{ar ? "إزالة" : "Remove"}</button></div>)}
      </details>}
    </section>
  );
}
