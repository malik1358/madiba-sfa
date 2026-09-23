import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase';
import {
  captureGpsLocationWithFallbackConfirm,
} from '../../../lib/customerLocation';
import { postJsonResilient } from '../../../lib/offlineApi';
import { upsertLocalPendingOrder } from '../../../lib/mobileDataCache';
import { promptCustomerMobileUpdateIfMissing } from '../../../lib/customerContact';
import { buildQueuedPendingOrderId } from '../../../lib/queuedSalesOrders';
import { allocateLocalSalesOrderNumber, rememberSalesmanOrderSequence } from '../../../lib/offlineOrderNumber';
import { resolveGpsCapturePlatform } from '../../../lib/geo';
import { loadVisitDistanceMetrics } from '../../../lib/visitDistanceWhatsapp';
import { buildOrderItems, buildOrderSummary, changeOrderQty, decreaseOrderQty, increaseOrderQty } from '../lib/orderHelpers';
import { getPrice } from '../lib/helpers';
import { normalizePaymentType } from '../../../lib/regionalPricing';
import { priceOrderLines } from '../../../lib/orderPricing';
import { claimUnsavedEntry } from '../../../lib/unsavedEntryGuard';
import { requestLoginFirstCustomerHintCheck } from '../../../lib/loginFirstCustomerHint';
import { friendlyErrorMessage } from '../../../lib/abortError';
import { blockedByAvgDaysMessage } from '../../../lib/customerOrderBlock';

function isPendingOrderId(orderId) {
  return String(orderId || '').startsWith('pending:');
}

function buildPendingOrderId(queueId) {
  return buildQueuedPendingOrderId(queueId);
}

function buildOrderPayload({
  action,
  selectedCustomer,
  orderItems,
  priceList,
  paymentType,
  cashDiscountMap,
  valueDiscountMap,
  schemes,
  pricingRegion,
  draftOrderId,
  loadedOrderStatus,
  location,
  capturedAt,
  platform,
  creditApprovalRequired = false,
  orderBlock = null,
  orderNumber = "",
}) {
  const pricedLines = priceOrderLines(
    orderItems.map((item) => ({
      item_code: item.item_code,
      item_name: item.item_name,
      category: item.category,
      quantity: Number(item.order_quantity),
      rate: Number(getPrice(priceList, item.item_code) || 0),
    })),
    {
      regionPriceMap: priceList,
      cashDiscountMap,
      valueDiscountMap,
      paymentType,
      schemes,
    },
  );

  return {
    action,
    orderId: draftOrderId && !isPendingOrderId(draftOrderId) ? Number(draftOrderId) : null,
    orderNumber: String(orderNumber || "").trim() || undefined,
    customerCode: selectedCustomer.customer_code,
    customerName: selectedCustomer.customer_name,
    salesmanCode: selectedCustomer.current_salesman_code,
    paymentType: normalizePaymentType(paymentType),
    pricingRegion,
    loadedOrderStatus: loadedOrderStatus || 'DRAFT',
    capturedAt,
    location,
    platform,
    creditApprovalRequired: Boolean(creditApprovalRequired),
    orderBlockSnapshot: orderBlock
      ? {
        avgDaysToPay: orderBlock.avgDaysToPay,
        threshold: orderBlock.threshold,
      }
      : null,
    lines: pricedLines,
  };
}

export function useOrder({
  analytics,
  quickOrderAllItems,
  catalogItems = [],
  selectedCustomer,
  priceList,
  setError,
  setMessage,
  accessScope = null,
  editOrderId = '',
  language = 'en',
  userRole = '',
  paymentType = 'credit',
  setPaymentType = null,
  cashDiscountMap = {},
  valueDiscountMap = {},
  schemes = [],
  pricingRegion = 'riyadh',
  setPricingRegion = null,
  creditApprovalRequired = false,
  orderBlock = null,
}) {
  const [draftOrderId, setDraftOrderId] = useState(null);
  const [draftOrderNumber, setDraftOrderNumber] = useState('');
  const [orderQuantities, setOrderQuantities] = useState({});
  const [savingOrder, setSavingOrder] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [showOrderReview, setShowOrderReview] = useState(false);
  const [orderHistory, setOrderHistory] = useState([]);
  const [loadedOrderStatus, setLoadedOrderStatus] = useState('DRAFT');

  const selectedQuantityCount = useMemo(
    () => Object.values(orderQuantities || {}).filter((qty) => Number(qty) > 0).length,
    [orderQuantities]
  );

  useEffect(() => {
    const orderEntryOpen = selectedQuantityCount > 0 || showOrderReview || savingOrder || submittingOrder;
    if (!orderEntryOpen) return undefined;
    return claimUnsavedEntry();
  }, [savingOrder, selectedQuantityCount, showOrderReview, submittingOrder]);

  const orderItems = useMemo(
    () => buildOrderItems(orderQuantities, analytics, quickOrderAllItems, catalogItems),
    [analytics, catalogItems, orderQuantities, quickOrderAllItems]
  );

  const orderSummary = useMemo(() => buildOrderSummary(orderItems), [orderItems]);

  useEffect(() => {
    async function loadDraftOrderOrEditOrder() {
      if (!selectedCustomer && !editOrderId) {
        setDraftOrderId(null);
        setDraftOrderNumber('');
        setOrderQuantities({});
        setOrderHistory([]);
        return;
      }

      if (!accessScope) {
        // Wait for visibility scope before resolving draft/edit access checks.
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        let order = null;

        if (editOrderId) {
          const { data: requestedOrder, error: requestedError } = await supabase
            .from('sales_orders')
            .select('id, customer_code, status, created_by, order_number')
            .eq('id', editOrderId)
            .maybeSingle();

          if (requestedError) throw requestedError;
          if (!requestedOrder) {
            throw new Error(`Order #${editOrderId} not found.`);
          }

          const canAccess = accessScope?.hasAllAccess
            || (accessScope?.visibleUserIds || []).includes(requestedOrder.created_by)
            || requestedOrder.created_by === session.user.id;

          if (!canAccess) {
            throw new Error('You do not have access to edit this order.');
          }

          order = requestedOrder;
        } else {
          let draftQuery = supabase
            .from('sales_orders')
            .select('id, customer_code, status, created_by, order_number')
            .eq('customer_code', selectedCustomer.customer_code)
            .eq('status', 'DRAFT')
            .order('updated_at', { ascending: false })
            .limit(1);

          if (accessScope?.hasAllAccess) {
            draftQuery = draftQuery;
          } else if (accessScope?.visibleUserIds?.length) {
            draftQuery = draftQuery.in('created_by', accessScope.visibleUserIds);
          } else {
            draftQuery = draftQuery.eq('created_by', session.user.id);
          }

          const { data: draft, error: draftError } = await draftQuery.maybeSingle();
          if (draftError) throw draftError;
          order = draft;
        }

        if (!order) {
          setDraftOrderId(null);
          setDraftOrderNumber('');
          setOrderQuantities({});
          setLoadedOrderStatus('DRAFT');
          setOrderHistory([]);
          return;
        }

        setDraftOrderId(order.id);
        setDraftOrderNumber(String(order.order_number || '').trim());
        if (order.order_number && selectedCustomer?.current_salesman_code) {
          void rememberSalesmanOrderSequence(selectedCustomer.current_salesman_code, order.order_number);
        }
        setLoadedOrderStatus(String(order.status || 'DRAFT').toUpperCase());
        const { data: lines, error: lineError } = await supabase
          .from('sales_order_items')
          .select('item_code, quantity')
          .eq('order_id', order.id);

        if (lineError) throw lineError;

        const loadedQuantities = {};
        (lines || []).forEach((line) => {
          loadedQuantities[line.item_code] = Number(line.quantity || 0);
        });

        setOrderQuantities(loadedQuantities);

        const historyResponse = await fetch(`/api/order-history?orderId=${encodeURIComponent(order.id)}`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        const historyPayload = await historyResponse.json().catch(() => ({}));
        if (!historyResponse.ok || !historyPayload.success) {
          setOrderHistory([]);
        } else {
          const history = Array.isArray(historyPayload.history) ? historyPayload.history : [];
          setOrderHistory(history);
          const latestPaymentType = [...history].reverse().find((entry) => entry?.paymentType)?.paymentType;
          if (latestPaymentType && typeof setPaymentType === "function") {
            setPaymentType(normalizePaymentType(latestPaymentType));
          }
          const latestPricingRegion = [...history].reverse().find((entry) => entry?.pricingRegion)?.pricingRegion;
          if (latestPricingRegion && typeof setPricingRegion === "function") {
            setPricingRegion(latestPricingRegion);
          }
        }
      } catch (err) {
        setError(friendlyErrorMessage(err, 'Unable to restore draft order.'));
      }
    }

    loadDraftOrderOrEditOrder();
  }, [accessScope, editOrderId, selectedCustomer, setError]);

  const updateQty = useCallback((itemCode, value) => {
    setOrderQuantities((current) => changeOrderQty(current, itemCode, value));
  }, []);

  const increaseQty = useCallback((itemCode) => {
    setOrderQuantities((current) => increaseOrderQty(current, itemCode));
  }, []);

  const decreaseQty = useCallback((itemCode) => {
    setOrderQuantities((current) => decreaseOrderQty(current, itemCode));
  }, []);

  const saveDraft = useCallback(async (options = {}) => {
    if (!selectedCustomer) return null;
    if (orderItems.length === 0) {
      if (selectedQuantityCount > 0) {
        setError('Selected items are not allowed for ordering. Please choose active items and try again.');
      } else {
        setError('Add at least one item before saving the draft.');
      }
      return null;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError('Supabase is not configured.');
      return null;
    }

    setSavingOrder(true);
    setError('');
    setMessage('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please login again.');

      await promptCustomerMobileUpdateIfMissing({
        language,
        customer: selectedCustomer,
        customerCode: selectedCustomer.customer_code,
        customerName: selectedCustomer.customer_name,
        accessToken: session.access_token,
        scope: accessScope,
      });

      const location = await captureGpsLocationWithFallbackConfirm(language, {
        customerCode: selectedCustomer.customer_code,
        customerName: selectedCustomer.customer_name,
        accessToken: session.access_token,
        role: userRole,
        customer: selectedCustomer,
      });
      const capturedAt = new Date().toISOString();
      const platform = await resolveGpsCapturePlatform();
      const visitDistance = await loadVisitDistanceMetrics({
        supabase,
        userId: session.user.id,
        location,
        customer: selectedCustomer,
        savedAt: capturedAt,
        skipTimeline: true,
      });

      const peerCodes = Object.keys(accessScope?.pricingRegionBySalesmanCode || {});
      const allottedOrderNumber = await allocateLocalSalesOrderNumber(
        selectedCustomer.current_salesman_code,
        {
          existingOrderNumber: draftOrderNumber,
          peerCodes,
        },
      );
      setDraftOrderNumber(allottedOrderNumber);

      const saveResult = await postJsonResilient({
        url: '/api/sales-orders',
        timeoutMs: 15000,
        queueFirst: true,
        jsonBody: buildOrderPayload({
          action: 'save_draft',
          selectedCustomer,
          orderItems,
          priceList,
          paymentType,
          cashDiscountMap,
          valueDiscountMap,
          schemes,
          pricingRegion,
          draftOrderId,
          loadedOrderStatus,
          location,
          capturedAt,
          platform,
          orderNumber: allottedOrderNumber,
        }),
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        metadata: {
          type: 'sales_order',
          action: 'save_draft',
          customerCode: selectedCustomer.customer_code,
          orderNumber: allottedOrderNumber,
        },
      });

      if (saveResult.queued) {
        const pendingOrderId = buildPendingOrderId(saveResult.queueId);
        if (!draftOrderId) {
          setDraftOrderId(pendingOrderId);
        }
        if (accessScope) {
          void upsertLocalPendingOrder(session.user.id, accessScope, {
            id: pendingOrderId,
            customer_code: selectedCustomer.customer_code,
            customer_name: selectedCustomer.customer_name,
            salesman_code: String(selectedCustomer.current_salesman_code || '').trim().toUpperCase(),
            order_number: allottedOrderNumber,
            created_at: capturedAt,
            updated_at: capturedAt,
            status: 'DRAFT',
            queuedLocally: true,
          });
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('madiba-pending-orders-changed'));
        }
        requestLoginFirstCustomerHintCheck();
        if (!options.silent) {
          setMessage(saveResult.message || 'Draft saved on device. It will sync automatically when you are back online.');
        }
        return { orderId: pendingOrderId, orderNumber: allottedOrderNumber, visitDistance };
      }

      const payload = saveResult.payload || {};
      if (!payload.orderId) {
        throw new Error('Unable to save draft order.');
      }

      const confirmedNumber = String(payload.orderNumber || allottedOrderNumber || payload.orderId || '').trim();
      setDraftOrderId(payload.orderId);
      setDraftOrderNumber(confirmedNumber);
      if (confirmedNumber) {
        void rememberSalesmanOrderSequence(selectedCustomer.current_salesman_code, confirmedNumber);
      }
      setOrderHistory(Array.isArray(payload.history) ? payload.history : []);
      setLoadedOrderStatus(String(payload.status || 'DRAFT').toUpperCase());
      requestLoginFirstCustomerHintCheck();
      if (!options.silent) {
        setMessage('Draft order saved successfully.');
      }
      return {
        orderId: payload.orderId,
        orderNumber: confirmedNumber,
        visitDistance,
      };
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Unable to save draft order.'));
      return null;
    } finally {
      setSavingOrder(false);
    }
  }, [accessScope, cashDiscountMap, draftOrderId, draftOrderNumber, language, loadedOrderStatus, orderItems, paymentType, priceList, pricingRegion, schemes, selectedCustomer, selectedQuantityCount, setError, setMessage, userRole, valueDiscountMap]);

  const submitOrder = useCallback(async (options = {}) => {
    if (orderItems.length === 0) {
      if (selectedQuantityCount > 0) {
        setError('Selected items are not allowed for ordering. Please choose active items and try again.');
      } else {
        setError('Add at least one item before submitting the order.');
      }
      return null;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError('Supabase is not configured.');
      return null;
    }

    setSubmittingOrder(true);
    setError('');
    setMessage('');

    try {
      if (orderBlock?.blocked) {
        throw new Error(blockedByAvgDaysMessage({
          threshold: orderBlock.threshold,
          avgDaysToPay: orderBlock.avgDaysToPay,
        }));
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please login again.');

      await promptCustomerMobileUpdateIfMissing({
        language,
        customer: selectedCustomer,
        customerCode: selectedCustomer?.customer_code,
        customerName: selectedCustomer?.customer_name,
        accessToken: session.access_token,
        scope: accessScope,
      });

      const location = await captureGpsLocationWithFallbackConfirm(language, {
        customerCode: selectedCustomer?.customer_code,
        customerName: selectedCustomer?.customer_name,
        accessToken: session.access_token,
        role: userRole,
        customer: selectedCustomer,
      });
      const capturedAt = new Date().toISOString();
      const platform = await resolveGpsCapturePlatform();
      const visitDistance = await loadVisitDistanceMetrics({
        supabase,
        userId: session.user.id,
        location,
        customer: selectedCustomer,
        savedAt: capturedAt,
        skipTimeline: true,
      });

      const peerCodes = Object.keys(accessScope?.pricingRegionBySalesmanCode || {});
      const allottedOrderNumber = await allocateLocalSalesOrderNumber(
        selectedCustomer?.current_salesman_code,
        {
          existingOrderNumber: draftOrderNumber,
          peerCodes,
        },
      );
      setDraftOrderNumber(allottedOrderNumber);

      const saveResult = await postJsonResilient({
        url: '/api/sales-orders',
        timeoutMs: 15000,
        queueFirst: true,
        jsonBody: buildOrderPayload({
          action: 'submit',
          selectedCustomer,
          orderItems,
          priceList,
          paymentType,
          cashDiscountMap,
          valueDiscountMap,
          schemes,
          pricingRegion,
          draftOrderId,
          loadedOrderStatus,
          location,
          capturedAt,
          platform,
          creditApprovalRequired: Boolean(options.creditApprovalRequired ?? creditApprovalRequired),
          orderBlock,
          orderNumber: allottedOrderNumber,
        }),
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        metadata: {
          type: 'sales_order',
          action: 'submit',
          customerCode: selectedCustomer?.customer_code || '',
          orderNumber: allottedOrderNumber,
        },
      });

      if (saveResult.queued) {
        const pendingOrderId = buildPendingOrderId(saveResult.queueId);
        if (!draftOrderId) {
          setDraftOrderId(pendingOrderId);
        }
        if (accessScope) {
          void upsertLocalPendingOrder(session.user.id, accessScope, {
            id: pendingOrderId,
            customer_code: selectedCustomer?.customer_code || '',
            customer_name: selectedCustomer?.customer_name || '',
            salesman_code: String(selectedCustomer?.current_salesman_code || '').trim().toUpperCase(),
            order_number: allottedOrderNumber,
            created_at: capturedAt,
            updated_at: capturedAt,
            status: 'SUBMITTED',
            queuedLocally: true,
          });
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('madiba-pending-orders-changed'));
        }
        requestLoginFirstCustomerHintCheck();
        if (!options.silent) {
          setMessage(saveResult.message || 'Order saved on device. It will submit automatically when you are back online.');
        }
        setShowOrderReview(false);
        setLoadedOrderStatus('SUBMITTED');
        return { orderId: pendingOrderId, orderNumber: allottedOrderNumber, visitDistance };
      }

      const payload = saveResult.payload || {};
      if (!payload.orderId) {
        throw new Error('Unable to submit order.');
      }

      const confirmedNumber = String(payload.orderNumber || allottedOrderNumber || payload.orderId || '').trim();
      setDraftOrderId(payload.orderId);
      setDraftOrderNumber(confirmedNumber);
      if (confirmedNumber) {
        void rememberSalesmanOrderSequence(selectedCustomer?.current_salesman_code, confirmedNumber);
      }
      setOrderHistory(Array.isArray(payload.history) ? payload.history : []);
      setLoadedOrderStatus(String(payload.status || 'SUBMITTED').toUpperCase());
      requestLoginFirstCustomerHintCheck();
      if (!options.silent) {
        setMessage(`Order #${confirmedNumber} submitted successfully.`);
      }
      setShowOrderReview(false);
      return {
        orderId: payload.orderId,
        orderNumber: confirmedNumber,
        visitDistance,
      };
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Unable to submit order.'));
      return null;
    } finally {
      setSubmittingOrder(false);
    }
  }, [accessScope, cashDiscountMap, creditApprovalRequired, draftOrderId, draftOrderNumber, language, loadedOrderStatus, orderBlock, orderItems, paymentType, priceList, pricingRegion, schemes, selectedCustomer, selectedQuantityCount, setError, setMessage, userRole, valueDiscountMap]);

  return {
    draftOrderId,
    orderQuantities,
    setOrderQuantities,
    savingOrder,
    submittingOrder,
    showOrderReview,
    setShowOrderReview,
    orderItems,
    orderSummary,
    orderHistory,
    loadedOrderStatus,
    updateQty,
    increaseQty,
    decreaseQty,
    saveDraft,
    submitOrder,
  };
}
