"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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
import { evaluateOrderSchemes } from "../../lib/orderSchemes.js";
import styles from "./order.module.css";

function formatExpiry(value) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CustomerOrderLinkPage() {
  const params = useParams();
  const token = String(params?.token || "").trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [catalog, setCatalog] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestId] = useState(() => (
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `req-${Date.now()}`
  ));

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
          throw new Error(payload?.error || "Unable to open this order link.");
        }
        if (!cancelled) {
          setCatalog(payload.catalog);
          if (payload.catalog?.submittedOrder?.orderNumber) {
            setMessage(`Order ${payload.catalog.submittedOrder.orderNumber} was submitted. This link stays open until ${formatExpiry(payload.catalog.expiresAt)} (Asia/Riyadh).`);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Unable to open this order link.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (token) load();
    return () => { cancelled = true; };
  }, [token]);

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

  const filteredItems = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => (
      String(item.item_code || "").toLowerCase().includes(q)
      || String(item.item_name || "").toLowerCase().includes(q)
      || String(item.category || "").toLowerCase().includes(q)
    ));
  }, [items, search]);

  function setQty(code, next) {
    if (readOnly) return;
    const qty = Math.max(0, Math.floor(Number(next) || 0));
    setQuantities((current) => ({ ...current, [code]: qty }));
  }

  async function submitOrder() {
    if (readOnly || submitting) return;
    if (orderLines.length === 0) {
      setError("Enter a quantity for at least one item.");
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
        throw new Error(payload?.error || "Unable to submit the order.");
      }
      setMessage(`Order ${payload.orderNumber} submitted successfully. Thank you.`);
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
      setError(err.message || "Unable to submit the order.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className={styles.page}><div className={styles.loading}>Opening your catalogue…</div></main>;
  }

  if (error && !catalog) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.brand}>MADIBA</div>
          <h1>{catalog?.customerName || "Your order"}</h1>
          <p>Browse available items, set quantities in the master unit (carton), and submit your order. No login required.</p>
          <div className={styles.meta}>
            {catalog?.customerCode ? <span>Code: {catalog.customerCode}</span> : null}
            {catalog?.pricingRegion ? (
              <span>
                Prices: {pricingRegionLabel(catalog.pricingRegion)}
                {" · "}
                {catalog.pricingType === "retail" ? "Retail" : "Wholesale"}
              </span>
            ) : null}
            {catalog?.expiresAt ? <span>Link valid until {formatExpiry(catalog.expiresAt)} (Asia/Riyadh)</span> : null}
          </div>
        </header>

        {message ? <div className={`${styles.banner} ${styles.bannerOk}`}>{message}</div> : null}
        {error ? <div className={`${styles.banner} ${styles.bannerError}`}>{error}</div> : null}
        {readOnly ? (
          <div className={`${styles.banner} ${styles.bannerWarn}`}>
            This order was already submitted. You can still view the catalogue until the link expires.
          </div>
        ) : null}

        {schemes.length > 0 ? (
          <section className={styles.schemes}>
            <h2>Active schemes</h2>
            <ul>
              {schemes.map((scheme) => (
                <li key={scheme.id}>
                  {scheme.name || scheme.id}
                  {scheme.rewardEveryQty > 0 && scheme.unitDiscountSar > 0
                    ? ` — ${formatMoneyAmount(scheme.unitDiscountSar)} ﷼ off every ${scheme.rewardEveryQty} of ${scheme.rewardItemCode}`
                    : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className={styles.toolbar}>
          <input
            type="search"
            placeholder="Search item code, name, or category"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search catalogue"
          />
        </div>

        {filteredItems.length === 0 ? (
          <div className={styles.empty}>
            {items.length === 0
              ? "No in-stock items are available on this link right now."
              : "No items match your search."}
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
              const unitLabel = item.master_unit || "master unit";
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
                      <div className={styles.placeholder}>No photo</div>
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <span className={styles.category}>{item.category || "General"}</span>
                    <h3>{item.item_name}</h3>
                    <div className={styles.code}>{item.item_code}</div>
                    {item.packing ? (
                      <p className={styles.packing}><strong>Packing:</strong> {item.packing}</p>
                    ) : null}
                    <div className={styles.priceRow}>
                      {discounted ? <del className={styles.originalPrice}>{formatMoneyAmount(item.price)} ﷼</del> : null}
                      <strong className={styles.price}>{formatMoneyAmount(priced.rate)} ﷼</strong>
                    </div>
                    <div className={styles.unitHint}>per {unitLabel}</div>
                    {(cashRate > 0 || volumeSlabRows.length > 0 || qty > 0) ? (
                      <div className={styles.linePricing}>
                        {cashRate > 0 ? (
                          <div className={styles.linePricingRow}>
                            <span>Cash discount</span>
                            <span>{formatDiscountPercent(cashRate)}{paymentType === "cash" ? "" : " · Cash only"}</span>
                          </div>
                        ) : null}
                        {volumeSlabRows.map((slab) => (
                          <div key={`${item.item_code}-vol-${slab.threshold}`} className={styles.linePricingRow}>
                            <span>Volume ≥ {formatMoneyAmount(slab.threshold)}</span>
                            <span>{formatDiscountPercent(slab.rate)}</span>
                          </div>
                        ))}
                        {qty > 0 ? (
                          <div className={styles.linePricingRow}>
                            <span>Item total</span>
                            <strong>{formatMoneyAmount(priced.lineValue)} ﷼</strong>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className={styles.qty}>
                      <button
                        type="button"
                        disabled={readOnly || qty <= 0}
                        aria-label={`Decrease ${item.item_name}`}
                        onClick={() => setQty(item.item_code, qty - 1)}
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        disabled={readOnly}
                        aria-label={`Quantity ${item.item_name}`}
                        value={qty || ""}
                        onChange={(event) => setQty(item.item_code, event.target.value)}
                      />
                      <button
                        type="button"
                        disabled={readOnly}
                        aria-label={`Increase ${item.item_name}`}
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
              <strong>{cartSummary.lines} item{cartSummary.lines === 1 ? "" : "s"}</strong>
              <span>
                Qty {cartSummary.totalQty} · {formatMoneyAmount(cartSummary.totalValue)} ﷼
              </span>
            </div>
            <button type="button" onClick={() => { void submitOrder(); }} disabled={submitting || cartSummary.lines === 0}>
              {submitting ? "Submitting…" : "Submit order"}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
