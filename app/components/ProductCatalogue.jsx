"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonWithTimeout, getSessionWithTimeout } from "../lib/authSession";
import { getSupabaseClient } from "../lib/supabase";
import { validateCataloguePreview } from "../lib/productCatalogue";
import { formatMoneyAmount, pricingRegionLabel } from "../lib/regionalPricing";
import styles from "./ProductCatalogue.module.css";

const PAGE_SIZE = 24;

function PhotoCarousel({ photos, name, language, onRemove }) {
  const [index, setIndex] = useState(0);
  const [failedUrl, setFailedUrl] = useState("");
  const current = photos[index % Math.max(photos.length, 1)];
  const ar = language === "ar";
  return (
    <div className={styles.gallery} aria-label={`${ar ? "صور" : "Photos"}: ${name}`}>
      {current && failedUrl !== current.url ? (
        <img src={current.url} alt={name} loading="lazy" onError={() => setFailedUrl(current.url)} />
      ) : (
        <div className={styles.placeholder}>
          <svg width="52" height="52" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <rect x="5" y="8" width="38" height="32" rx="4" stroke="currentColor" strokeWidth="2" />
            <circle cx="16" cy="18" r="4" stroke="currentColor" strokeWidth="2" />
            <path d="m6 35 11-10 8 7 8-13 10 16" stroke="currentColor" strokeWidth="2" />
          </svg>
          <span>{current ? (ar ? "تعذر عرض الصورة. اختر صورة أخرى." : "Unable to preview this image. Choose another photo.") : (ar ? "لا توجد صورة بعد" : "No photo yet")}</span>
        </div>
      )}
      {photos.length > 1 && (
        <div className={styles.carouselControls}>
          <button type="button" aria-label={ar ? "الصورة السابقة" : "Previous photo"} onClick={() => setIndex((value) => (value - 1 + photos.length) % photos.length)}>&lt;</button>
          <span aria-live="polite">{index % photos.length + 1} / {photos.length}</span>
          <button type="button" aria-label={ar ? "الصورة التالية" : "Next photo"} onClick={() => setIndex((value) => (value + 1) % photos.length)}>&gt;</button>
        </div>
      )}
      {current && onRemove && (
        <button type="button" className={styles.removePhoto} onClick={() => onRemove(current.id)}>{ar ? "إزالة المعاينة" : "Remove preview"}</button>
      )}
    </div>
  );
}

export default function ProductCatalogue({
  items, categories, search, onSearch, category, onCategory, quantities,
  onQty, onIncrease, onDecrease, priceList, pricingRegion, language,
  selectedCustomer, customers, onCustomer, orderTotal, selectedCount, orderLines,
}) {
  const ar = language === "ar";
  const [details, setDetails] = useState({});
  const [warnings, setWarnings] = useState([]);
  const [canManagePhotos, setCanManagePhotos] = useState(false);
  const [previewPhotos, setPreviewPhotos] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const previewUrls = useRef(new Set());
  const mounted = useRef(false);

  const request = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase is not configured.");
    const session = await getSessionWithTimeout(supabase);
    if (!session?.access_token) throw new Error("Please login again.");
    const { response, payload } = await fetchJsonWithTimeout("/api/product-catalogue", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }, 45000);
    if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load product packing.");
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
    } catch (err) {
      if (mounted.current) setError(err.message || "Unable to load product packing.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.current.clear();
    };
  }, [refresh]);

  useEffect(() => { setPage(0); }, [search, category]);

  function preview(itemCode, file) {
    if (!file || !canManagePhotos) return;
    setError("");
    try {
      validateCataloguePreview(file);
      const url = URL.createObjectURL(file);
      previewUrls.current.add(url);
      setPreviewPhotos((current) => ({
        ...current, [itemCode]: [...(current[itemCode] || []), { id: url, url }],
      }));
    } catch (err) {
      setError(err.message || "Unable to preview this photo.");
    }
  }

  function remove(itemCode, photoId) {
    if (!canManagePhotos) return;
    setPreviewPhotos((current) => ({
      ...current, [itemCode]: (current[itemCode] || []).filter((photo) => photo.id !== photoId),
    }));
    URL.revokeObjectURL(photoId);
    previewUrls.current.delete(photoId);
  }

  const lastPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = items.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  return (
    <section className={`moduleSection ${styles.catalogue}`}>
      <div className="moduleSectionHeader">
        <h2>{ar ? "تصفح المنتجات" : "Shop the catalogue"}</h2>
        <span>{items.length} {ar ? "منتج" : "products"} · {pricingRegionLabel(pricingRegion)}</span>
      </div>
      <label className={styles.customer}>
        {ar ? "العميل للطلب" : "Order customer"}
        <select className="moduleInput" value={selectedCustomer?.customer_code || ""} onChange={(event) => onCustomer(event.target.value)}>
          <option value="">{ar ? "اختر العميل" : "Select a customer"}</option>
          {customers.map((customer) => <option key={customer.customer_code} value={customer.customer_code}>{customer.customer_code} - {customer.customer_name}</option>)}
        </select>
      </label>
      <div className={styles.toolbar}>
        <label>{ar ? "البحث" : "Search"}
          <input className="moduleInput" placeholder={ar ? "رمز الصنف أو الاسم أو الفئة" : "Item code, name, or category"} value={search} onChange={(event) => onSearch(event.target.value)} />
        </label>
        <label>{ar ? "الفئة" : "Category"}
          <select className="moduleInput" value={category} onChange={(event) => onCategory(event.target.value)}>
            {categories.map((value) => <option key={value} value={value}>{value === "ALL" ? (ar ? "كل الفئات" : "All categories") : value}</option>)}
          </select>
        </label>
        <button type="button" className="moduleInlineButton" disabled={loading} onClick={refresh}>{ar ? "تحديث التعبئة" : "Refresh packing"}</button>
      </div>
      <p className="moduleHint">
        {ar ? "الأسعار بالجملة قبل الضريبة. الخصومات والعروض تحسب في مراجعة الطلب." : "Wholesale prices exclude VAT. Cash discounts, value discounts, and schemes are calculated in the order review."}
      </p>
      <p className={styles.notice}>{ar ? "ربط تخزين الصور مؤجل. الصور للمعاينة فقط في هذه الصفحة ولا يتم رفعها أو حفظها أو مشاركتها، وتختفي عند تحديث الصفحة أو مغادرتها." : "Image storage is not connected yet. Photo previews are only for this page: they are not uploaded, saved, or shared, and disappear when you reload or leave."}</p>
      {canManagePhotos && <p className="moduleHint">{ar ? "معاينة صور JPEG أو PNG أو WebP، بحد أقصى 3 ميجابايت للصورة. اختر عدة صور للصنف لتجربة الشرائح." : "Preview JPEG, PNG, or WebP photos, up to 3 MB each. Select more than one photo to try the carousel."}</p>}
      {loading && <p role="status">{ar ? "جاري تحميل التعبئة..." : "Loading packing..."}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {warnings.map((warning) => <p key={warning} className={styles.notice}>{warning}</p>)}
      {!selectedCustomer && <p className={styles.notice}><a href="#catalogue-customer">{ar ? "اختر العميل أدناه لإعداد الطلب." : "Choose a customer below to prepare an order."}</a> {ar ? "يمكنك تصفح جميع المنتجات الآن." : "You can browse all products now."}</p>}
      <div className={styles.grid}>
        {visible.map((item) => {
          const detail = details[item.item_code] || {};
          const qty = Number(quantities[item.item_code] || 0);
          const price = Number(priceList[item.item_code]);
          const hasPrice = Number.isFinite(price) && price > 0;
          const disabled = !selectedCustomer || !hasPrice;
          return (
            <article key={item.item_code} className={`${styles.card} ${qty > 0 ? styles.selected : ""}`}>
              <PhotoCarousel photos={previewPhotos[item.item_code] || []} name={item.item_name} language={language}
                onRemove={canManagePhotos ? (id) => remove(item.item_code, id) : undefined} />
              <div className={styles.cardBody}>
                <span className={styles.category}>{item.category}</span>
                <h3>{item.item_name}</h3>
                <div className="moduleCode">{item.item_code}</div>
                <p className={styles.packing}>
                  <strong>{ar ? "التعبئة" : "Packing"}:</strong> {detail.sellingUnit || (ar ? "الوحدة غير محددة" : "Unit not specified")}
                  {detail.packing ? <span>{detail.packing}</span> : <span>{ar ? "حجم العبوة غير متوفر" : "Pack size not available"}</span>}
                </p>
                <strong className={styles.price}>{hasPrice ? `${formatMoneyAmount(price)} ﷼` : (ar ? "السعر غير متوفر" : "Price unavailable")}</strong>
                {hasPrice && detail.sellingUnit && <span className="moduleCode">{ar ? "لكل" : "per"} {detail.sellingUnit}</span>}
                <div className={styles.qty}>
                  <button type="button" disabled={disabled || qty <= 0} aria-label={`${ar ? "تقليل" : "Decrease"} ${item.item_name}`} onClick={() => onDecrease(item.item_code)}>-</button>
                  <input type="number" min="0" step="1" disabled={disabled} aria-label={`${ar ? "الكمية" : "Quantity"} ${item.item_name}`} value={qty || ""}
                    onChange={(event) => onQty(item.item_code, event.target.value)} />
                  <button type="button" disabled={disabled} aria-label={`${ar ? "إضافة" : "Add"} ${item.item_name}`} onClick={() => onIncrease(item.item_code)}>+</button>
                </div>
                {canManagePhotos && (
                  <label className={styles.upload}>
                    {ar ? "معاينة صورة (غير محفوظة)" : "Preview photo (not saved)"}
                    <input type="file" accept="image/jpeg,image/png,image/webp"
                      aria-label={`${ar ? "معاينة صورة" : "Preview photo"} ${item.item_code}`}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        preview(item.item_code, file);
                      }} />
                  </label>
                )}
              </div>
            </article>
          );
        })}
      </div>
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
