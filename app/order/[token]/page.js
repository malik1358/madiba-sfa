"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import { translate } from "../../lib/appLanguage.js";
import {
  catalogueCardPrice,
} from "../../lib/productCatalogue.js";
import {
  formatDiscountPercent,
  formatMoneyAmount,
  lookupDiscountRate,
  lookupValueDiscountSlabs,
  pricingRegionLabel,
  VALUE_DISCOUNT_SLABS,
} from "../../lib/regionalPricing.js";
import { orderRateInUnit } from "../../lib/masterUnitQty.js";
import { evaluateOrderSchemes } from "../../lib/orderSchemes.js";
import styles from "./order.module.css";

const TEXT = {
  opening: { en: "Opening your catalogue…", ar: "جاري فتح الكتالوج…" },
  yourOrder: { en: "Your order", ar: "طلبك" },
  intro: {
    en: "Browse the catalogue, set quantities in the master unit (carton), and submit your order. No login required.",
    ar: "تصفح الكتالوج، أدخل الكمية بوحدة الكرتون (الوحدة الكبرى)، ثم أرسل الطلب. لا يلزم تسجيل الدخول.",
  },
  code: { en: "Code", ar: "الكود" },
  prices: { en: "Prices", ar: "الأسعار" },
  wholesale: { en: "Wholesale", ar: "جملة" },
  retail: { en: "Retail", ar: "تجزئة" },
  validUntil: { en: "Link valid until", ar: "الرابط صالح حتى" },
  ksa: { en: "Asia/Riyadh", ar: "توقيت الرياض" },
  alreadySubmitted: {
    en: "This order was already submitted. You can still view the catalogue until the link expires.",
    ar: "تم إرسال هذا الطلب مسبقاً. يمكنك متابعة عرض الكتالوج حتى انتهاء صلاحية الرابط.",
  },
  submittedKeepOpen: {
    en: "Order {order} was submitted. This link stays open until {until} ({tz}).",
    ar: "تم إرسال الطلب {order}. يبقى هذا الرابط مفتوحاً حتى {until} ({tz}).",
  },
  submittedOk: {
    en: "Order {order} submitted successfully. Thank you.",
    ar: "تم إرسال الطلب {order} بنجاح. شكراً لك.",
  },
  activeSchemes: { en: "Active schemes", ar: "العروض النشطة" },
  schemeOff: {
    en: "{amount} ﷼ off every {qty} of {code}",
    ar: "خصم {amount} ﷼ لكل {qty} من {code}",
  },
  searchPlaceholder: {
    en: "Search item code or name",
    ar: "ابحث بكود الصنف أو الاسم",
  },
  searchAria: { en: "Search catalogue", ar: "بحث في الكتالوج" },
  category: { en: "Category", ar: "الفئة" },
  allCategories: { en: "All categories", ar: "كل الفئات" },
  noStock: {
    en: "No catalogue items are ready on this link right now.",
    ar: "لا توجد أصناف جاهزة على هذا الرابط حالياً.",
  },
  noMatch: { en: "No items match your search.", ar: "لا توجد أصناف مطابقة لبحثك." },
  noPhoto: { en: "No photo", ar: "لا توجد صورة" },
  general: { en: "General", ar: "عام" },
  packing: { en: "Packing", ar: "التعبئة" },
  per: { en: "per", ar: "لكل" },
  masterUnit: { en: "master unit", ar: "الوحدة الكبرى" },
  baseUnit: { en: "Pcs", ar: "قطعة" },
  lowestUnitPrice: { en: "Lowest unit", ar: "أقل وحدة" },
  cashDiscount: { en: "Cash discount", ar: "خصم نقدي" },
  cashOnly: { en: "Cash only", ar: "نقداً فقط" },
  volume: { en: "Volume", ar: "خصم الكمية" },
  itemTotal: { en: "Item total", ar: "إجمالي الصنف" },
  decrease: { en: "Decrease", ar: "تقليل" },
  increase: { en: "Increase", ar: "زيادة" },
  quantity: { en: "Quantity", ar: "الكمية" },
  items: { en: "items", ar: "أصناف" },
  item: { en: "item", ar: "صنف" },
  qty: { en: "Qty", ar: "الكمية" },
  submit: { en: "Submit order", ar: "إرسال الطلب" },
  submitting: { en: "Submitting…", ar: "جاري الإرسال…" },
  needQty: {
    en: "Enter a quantity for at least one item.",
    ar: "أدخل كمية لصنف واحد على الأقل.",
  },
  openFailed: {
    en: "Unable to open this order link.",
    ar: "تعذر فتح رابط الطلب.",
  },
  submitFailed: {
    en: "Unable to submit the order.",
    ar: "تعذر إرسال الطلب.",
  },
};

function formatExpiry(value, language = "ar") {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString(language === "ar" ? "ar-SA" : "en-GB", {
    timeZone: "Asia/Riyadh",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fillTemplate(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, key) => (
    values[key] == null ? "" : String(values[key])
  ));
}

export default function CustomerOrderLinkPage() {
  const params = useParams();
  const token = String(params?.token || "").trim();
  // Customer links always open in Arabic; guest can switch to English on this page only.
  const [language, setLanguage] = useState("ar");
  const t = translate(language, TEXT);
  const dir = language === "ar" ? "rtl" : "ltr";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [catalog, setCatalog] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestId] = useState(() => (
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `req-${Date.now()}`
  ));

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousLang = document.documentElement.lang;
    const previousDir = document.documentElement.dir;
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
    if (document.body) document.body.dir = dir;
    return () => {
      document.documentElement.lang = previousLang || "en";
      document.documentElement.dir = previousDir || "ltr";
      if (document.body) document.body.dir = previousDir || "ltr";
    };
  }, [language, dir]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/customer-order-links/${encodeURIComponent(token)}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || t("openFailed"));
        }
        if (!cancelled) {
          setCatalog(payload.catalog);
          if (payload.catalog?.submittedOrder?.orderNumber) {
            setMessage(fillTemplate(t("submittedKeepOpen"), {
              order: payload.catalog.submittedOrder.orderNumber,
              until: formatExpiry(payload.catalog.expiresAt, language),
              tz: t("ksa"),
            }));
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || t("openFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (token) load();
    return () => { cancelled = true; };
    // Intentionally load once per token; language only affects labels after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!catalog?.submittedOrder?.orderNumber) return;
    const label = translate(language, TEXT);
    setMessage(fillTemplate(label("submittedKeepOpen"), {
      order: catalog.submittedOrder.orderNumber,
      until: formatExpiry(catalog.expiresAt, language),
      tz: label("ksa"),
    }));
  }, [catalog, language]);

  const items = catalog?.items || [];
  const schemes = catalog?.schemes || [];
  const cashDiscountMap = catalog?.cashDiscountMap || {};
  const valueDiscountMap = catalog?.valueDiscountMap || {};
  const paymentType = catalog?.paymentType || "credit";
  const readOnly = Boolean(catalog?.readOnly);

  const orderLines = useMemo(() => (
    items
      .map((item) => ({
        item_code: item.item_code,
        item_name: item.item_name,
        category: item.category,
        quantity: Number(quantities[item.item_code] || 0),
      }))
      .filter((line) => line.quantity > 0)
  ), [items, quantities]);

  const schemeApplications = useMemo(
    () => evaluateOrderSchemes(orderLines, schemes),
    [orderLines, schemes],
  );

  const cartSummary = useMemo(() => {
    let totalQty = 0;
    let totalValue = 0;
    for (const item of items) {
      const qty = Number(quantities[item.item_code] || 0);
      if (!(qty > 0)) continue;
      totalQty += qty;
      const priced = catalogueCardPrice(item, {
        price: item.price,
        quantity: qty,
        paymentType,
        cashDiscountMap,
        valueDiscountMap,
        schemeApplications,
      });
      totalValue += Number(priced.lineValue || 0);
    }
    return {
      lines: orderLines.length,
      totalQty,
      totalValue: Math.round(totalValue * 100) / 100,
    };
  }, [items, quantities, paymentType, cashDiscountMap, valueDiscountMap, schemeApplications, orderLines.length]);

  const categories = useMemo(() => {
    const set = new Set();
    for (const item of items) {
      const category = String(item.category || "").trim();
      if (category) set.add(category);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const selectedCategory = String(categoryFilter || "").trim();
    return items.filter((item) => {
      if (selectedCategory && String(item.category || "").trim() !== selectedCategory) return false;
      if (!q) return true;
      return String(item.item_code || "").toLowerCase().includes(q)
        || String(item.item_name || "").toLowerCase().includes(q)
        || String(item.category || "").toLowerCase().includes(q);
    });
  }, [items, search, categoryFilter]);

  function setQty(code, next) {
    if (readOnly) return;
    const qty = Math.max(0, Math.floor(Number(next) || 0));
    setQuantities((current) => ({ ...current, [code]: qty }));
  }

  async function submitOrder() {
    if (readOnly || submitting) return;
    if (orderLines.length === 0) {
      setError(t("needQty"));
      return;
    }
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/customer-order-links/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          requestId,
          lines: orderLines.map((line) => ({
            item_code: line.item_code,
            item_name: line.item_name,
            category: line.category,
            quantity: line.quantity,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || t("submitFailed"));
      }
      setMessage(fillTemplate(t("submittedOk"), { order: payload.orderNumber }));
      setCatalog((current) => current ? {
        ...current,
        readOnly: true,
        submittedOrder: {
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
          submittedAt: new Date().toISOString(),
          totalValue: payload.totalValue,
          lines: orderLines.map((line) => ({
            item_code: line.item_code,
            item_name: line.item_name,
            quantity: line.quantity,
            rate: 0,
            line_value: 0,
          })),
        },
      } : current);
    } catch (err) {
      setError(err.message || t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className={styles.page} dir={dir} lang={language}>
        <div className={styles.loading}>{t("opening")}</div>
      </main>
    );
  }

  if (error && !catalog) {
    return (
      <main className={styles.page} dir={dir} lang={language}>
        <div className={styles.shell}>
          <div className={styles.langBar}>
            <AppLanguageSwitch language={language} setLanguage={setLanguage} />
          </div>
          <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page} dir={dir} lang={language}>
      <div className={styles.shell}>
        <div className={styles.langBar}>
          <AppLanguageSwitch language={language} setLanguage={setLanguage} />
        </div>
        <header className={styles.hero}>
          <div className={styles.brand}>MADIBA</div>
          <h1>{catalog?.customerName || t("yourOrder")}</h1>
          <p>{t("intro")}</p>
          <div className={styles.meta}>
            {catalog?.customerCode ? <span>{t("code")}: {catalog.customerCode}</span> : null}
            {catalog?.pricingRegion ? (
              <span>
                {t("prices")}: {pricingRegionLabel(catalog.pricingRegion)}
                {" · "}
                {catalog.pricingType === "retail" ? t("retail") : t("wholesale")}
              </span>
            ) : null}
            {catalog?.expiresAt ? (
              <span>
                {t("validUntil")} {formatExpiry(catalog.expiresAt, language)} ({t("ksa")})
              </span>
            ) : null}
          </div>
        </header>

        {message ? <div className={`${styles.banner} ${styles.bannerOk}`}>{message}</div> : null}
        {error ? <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div> : null}
        {readOnly ? (
          <div className={`${styles.banner} ${styles.bannerWarn}`}>
            {t("alreadySubmitted")}
          </div>
        ) : null}

        {schemes.length > 0 ? (
          <section className={styles.schemes}>
            <h2>{t("activeSchemes")}</h2>
            <ul>
              {schemes.map((scheme) => (
                <li key={scheme.id}>
                  {scheme.name || scheme.id}
                  {scheme.rewardEveryQty > 0 && scheme.unitDiscountSar > 0
                    ? ` — ${fillTemplate(t("schemeOff"), {
                      amount: formatMoneyAmount(scheme.unitDiscountSar),
                      qty: scheme.rewardEveryQty,
                      code: scheme.rewardItemCode,
                    })}`
                    : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className={styles.toolbar}>
          <label className={styles.categoryFilter}>
            <span>{t("category")}</span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label={t("category")}
            >
              <option value="">{t("allCategories")}</option>
              {categories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
          <input
            type="search"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t("searchAria")}
          />
        </div>

        {filteredItems.length === 0 ? (
          <div className={styles.empty}>
            {items.length === 0 ? t("noStock") : t("noMatch")}
          </div>
        ) : (
          <div className={styles.grid}>
            {filteredItems.map((item) => {
              const qty = Number(quantities[item.item_code] || 0);
              const priced = catalogueCardPrice(item, {
                price: item.price,
                quantity: qty,
                paymentType,
                cashDiscountMap,
                valueDiscountMap,
                schemeApplications,
              });
              const cashRate = lookupDiscountRate(cashDiscountMap, item.item_code);
              const valueSlabs = lookupValueDiscountSlabs(valueDiscountMap, item.item_code);
              const volumeSlabRows = VALUE_DISCOUNT_SLABS
                .map((threshold) => ({ threshold, rate: Number(valueSlabs[String(threshold)] || 0) }))
                .filter((slab) => slab.rate > 0);
              const discounted = priced.rate < item.price - 0.000001;
              const photoId = item.photos?.[0]?.id;
              const unitLabel = item.master_unit || t("masterUnit");
              const unitConv = Number(item.unit_conv) || 0;
              const baseUnitLabel = item.base_unit || t("baseUnit");
              const lowestUnitRate = unitConv > 1
                ? orderRateInUnit(priced.rate, unitConv)
                : 0;
              const lowestUnitBase = unitConv > 1 && discounted
                ? orderRateInUnit(item.price, unitConv)
                : 0;
              return (
                <article key={item.item_code} className={`${styles.card} ${qty > 0 ? styles.selected : ""}`}>
                  <div className={styles.gallery}>
                    {photoId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/customer-order-links/${encodeURIComponent(token)}/photo?photoId=${encodeURIComponent(photoId)}`}
                        alt={item.item_name}
                      />
                    ) : (
                      <div className={styles.placeholder}>{t("noPhoto")}</div>
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <span className={styles.category}>{item.category || t("general")}</span>
                    <h3>{item.item_name}</h3>
                    <div className={styles.code}>{item.item_code}</div>
                    {item.packing ? (
                      <p className={styles.packing}><strong>{t("packing")}:</strong> {item.packing}</p>
                    ) : null}
                    <div className={styles.priceRow}>
                      {discounted ? <del className={styles.originalPrice}>{formatMoneyAmount(item.price)} ﷼</del> : null}
                      <strong className={styles.price}>{formatMoneyAmount(priced.rate)} ﷼</strong>
                    </div>
                    <div className={styles.unitHint}>{t("per")} {unitLabel}</div>
                    {lowestUnitRate > 0 ? (
                      <div className={styles.lowestUnit}>
                        <span>{t("lowestUnitPrice")}: </span>
                        {lowestUnitBase > 0 ? (
                          <del className={styles.originalPrice}>{formatMoneyAmount(lowestUnitBase)} ﷼</del>
                        ) : null}
                        <strong>{formatMoneyAmount(lowestUnitRate)} ﷼</strong>
                        <span> {t("per")} {baseUnitLabel}</span>
                      </div>
                    ) : null}
                    {(cashRate > 0 || volumeSlabRows.length > 0 || qty > 0) ? (
                      <div className={styles.linePricing}>
                        {cashRate > 0 ? (
                          <div className={styles.linePricingRow}>
                            <span>{t("cashDiscount")}</span>
                            <span>
                              {formatDiscountPercent(cashRate)}
                              {paymentType === "cash" ? "" : ` · ${t("cashOnly")}`}
                            </span>
                          </div>
                        ) : null}
                        {volumeSlabRows.map((slab) => (
                          <div key={`${item.item_code}-vol-${slab.threshold}`} className={styles.linePricingRow}>
                            <span>{t("volume")} ≥ {formatMoneyAmount(slab.threshold)}</span>
                            <span>{formatDiscountPercent(slab.rate)}</span>
                          </div>
                        ))}
                        {qty > 0 ? (
                          <div className={styles.linePricingRow}>
                            <span>{t("itemTotal")}</span>
                            <strong>{formatMoneyAmount(priced.lineValue)} ﷼</strong>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className={styles.qty}>
                      <button
                        type="button"
                        disabled={readOnly || qty <= 0}
                        aria-label={`${t("decrease")} ${item.item_name}`}
                        onClick={() => setQty(item.item_code, qty - 1)}
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        disabled={readOnly}
                        aria-label={`${t("quantity")} ${item.item_name}`}
                        value={qty || ""}
                        onChange={(event) => setQty(item.item_code, event.target.value)}
                      />
                      <button
                        type="button"
                        disabled={readOnly}
                        aria-label={`${t("increase")} ${item.item_name}`}
                        onClick={() => setQty(item.item_code, qty + 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!readOnly ? (
          <div className={styles.cart}>
            <div>
              <strong>
                {cartSummary.lines} {cartSummary.lines === 1 ? t("item") : t("items")}
              </strong>
              <span>
                {t("qty")} {cartSummary.totalQty} · {formatMoneyAmount(cartSummary.totalValue)} ﷼
              </span>
            </div>
            <button type="button" onClick={() => { void submitOrder(); }} disabled={submitting || cartSummary.lines === 0}>
              {submitting ? t("submitting") : t("submit")}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
