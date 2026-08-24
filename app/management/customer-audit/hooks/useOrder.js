import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase';
import {
  captureGpsLocationWithFallbackConfirm,
} from '../../../lib/customerLocation';
import { postJsonResilient } from '../../../lib/offlineApi';
import { resolveGpsCapturePlatform } from '../../../lib/geo';
import { buildOrderItems, buildOrderSummary, changeOrderQty, decreaseOrderQty, increaseOrderQty } from '../lib/orderHelpers';
import { getPrice } from '../lib/helpers';

function isPendingOrderId(orderId) {
  return String(orderId || '').startsWith('pending:');
}

function buildPendingOrderId(queueId) {
  return `pending:${String(queueId || '').slice(0, 12)}`;
}

function buildOrderPayload({
  action,
  selectedCustomer,
  orderItems,
  priceList,
  draftOrderId,
  loadedOrderStatus,
  location,
  capturedAt,
  platform,
}) {
  return {
    action,
    orderId: draftOrderId && !isPendingOrderId(draftOrderId) ? Number(draftOrderId) : null,
    customerCode: selectedCustomer.customer_code,
    customerName: selectedCustomer.customer_name,
    salesmanCode: selectedCustomer.current_salesman_code,
    loadedOrderStatus: loadedOrderStatus || 'DRAFT',
    capturedAt,
    location,
    platform,
    lines: orderItems.map((item) => ({
      item_code: item.item_code,
      item_name: item.item_name,
      category: item.category,
      quantity: Number(item.order_quantity),
      rate: Number(getPrice(priceList, item.item_code) || 0),
      line_value: Number(getPrice(priceList, item.item_code) || 0) * Number(item.order_quantity),
    })),
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
}) {
  const [draftOrderId, setDraftOrderId] = useState(null);
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

  const orderItems = useMemo(
    () => buildOrderItems(orderQuantities, analytics, quickOrderAllItems, catalogItems),
    [analytics, catalogItems, orderQuantities, quickOrderAllItems]
  );

  const orderSummary = useMemo(() => buildOrderSummary(orderItems), [orderItems]);

  useEffect(() => {
    async function loadDraftOrderOrEditOrder() {
      if (!selectedCustomer && !editOrderId) {
        setDraftOrderId(null);
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
            .select('id, customer_code, status, created_by')
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
            .select('id, customer_code, status, created_by')
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
          setOrderQuantities({});
          setLoadedOrderStatus('DRAFT');
          setOrderHistory([]);
          return;
        }

        setDraftOrderId(order.id);
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
          setOrderHistory(Array.isArray(historyPayload.history) ? historyPayload.history : []);
        }
      } catch (err) {
        setError(err.message || 'Unable to restore draft order.');
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

  const saveDraft = useCallback(async () => {
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

      const location = await captureGpsLocationWithFallbackConfirm(language, {
        customerCode: selectedCustomer.customer_code,
        customerName: selectedCustomer.customer_name,
        accessToken: session.access_token,
        skipCustomerLocationUpdate: true,
        role: userRole,
      });
      const capturedAt = new Date().toISOString();
      const platform = await resolveGpsCapturePlatform();

      const saveResult = await postJsonResilient({
        url: '/api/sales-orders',
        timeoutMs: 15000,
        jsonBody: buildOrderPayload({
          action: 'save_draft',
          selectedCustomer,
          orderItems,
          priceList,
          draftOrderId,
          loadedOrderStatus,
          location,
          capturedAt,
          platform,
        }),
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        metadata: {
          type: 'sales_order',
          action: 'save_draft',
          customerCode: selectedCustomer.customer_code,
        },
      });

      if (saveResult.queued) {
        const pendingOrderId = buildPendingOrderId(saveResult.queueId);
        if (!draftOrderId) {
          setDraftOrderId(pendingOrderId);
        }
        setMessage(saveResult.message || 'Draft saved on device. It will sync automatically when you are back online.');
        return pendingOrderId;
      }

      const payload = saveResult.payload || {};
      if (!payload.orderId) {
        throw new Error('Unable to save draft order.');
      }

      setDraftOrderId(payload.orderId);
      setOrderHistory(Array.isArray(payload.history) ? payload.history : []);
      setLoadedOrderStatus(String(payload.status || 'DRAFT').toUpperCase());
      setMessage('Draft order saved successfully.');
      return payload.orderId;
    } catch (err) {
      setError(err.message || 'Unable to save draft order.');
      return null;
    } finally {
      setSavingOrder(false);
    }
  }, [draftOrderId, language, loadedOrderStatus, orderItems, priceList, selectedCustomer, selectedQuantityCount, setError, setMessage, userRole]);

  const submitOrder = useCallback(async () => {
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please login again.');

      const location = await captureGpsLocationWithFallbackConfirm(language, {
        customerCode: selectedCustomer?.customer_code,
        customerName: selectedCustomer?.customer_name,
        accessToken: session.access_token,
        skipCustomerLocationUpdate: true,
        role: userRole,
      });
      const capturedAt = new Date().toISOString();
      const platform = await resolveGpsCapturePlatform();

      const saveResult = await postJsonResilient({
        url: '/api/sales-orders',
        timeoutMs: 15000,
        jsonBody: buildOrderPayload({
          action: 'submit',
          selectedCustomer,
          orderItems,
          priceList,
          draftOrderId,
          loadedOrderStatus,
          location,
          capturedAt,
          platform,
        }),
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        metadata: {
          type: 'sales_order',
          action: 'submit',
          customerCode: selectedCustomer?.customer_code || '',
        },
      });

      if (saveResult.queued) {
        const pendingOrderId = buildPendingOrderId(saveResult.queueId);
        if (!draftOrderId) {
          setDraftOrderId(pendingOrderId);
        }
        setMessage(saveResult.message || 'Order saved on device. It will submit automatically when you are back online.');
        setShowOrderReview(false);
        setLoadedOrderStatus('SUBMITTED');
        return pendingOrderId;
      }

      const payload = saveResult.payload || {};
      if (!payload.orderId) {
        throw new Error('Unable to submit order.');
      }

      setDraftOrderId(payload.orderId);
      setOrderHistory(Array.isArray(payload.history) ? payload.history : []);
      setLoadedOrderStatus(String(payload.status || 'SUBMITTED').toUpperCase());
      setMessage(`Order #${payload.orderId} submitted successfully.`);
      setShowOrderReview(false);
      return payload.orderId;
    } catch (err) {
      setError(err.message || 'Unable to submit order.');
      return null;
    } finally {
      setSubmittingOrder(false);
    }
  }, [draftOrderId, language, loadedOrderStatus, orderItems, priceList, selectedCustomer, selectedQuantityCount, setError, setMessage, userRole]);

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
