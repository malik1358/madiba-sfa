import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase';
import { insertGpsActivityLog, requireGpsLocation } from '../../../lib/geo';
import { buildOrderItems, buildOrderSummary, changeOrderQty, decreaseOrderQty, increaseOrderQty } from '../lib/orderHelpers';
import { getPrice } from '../lib/helpers';

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildChangeSet(beforeLines = [], afterLines = []) {
  const beforeMap = new Map();
  const afterMap = new Map();

  beforeLines.forEach((line) => {
    const code = normalizeCode(line.item_code);
    if (!code) return;
    beforeMap.set(code, {
      item_code: code,
      item_name: String(line.item_name || code),
      quantity: toNumber(line.quantity),
      rate: toNumber(line.rate),
    });
  });

  afterLines.forEach((line) => {
    const code = normalizeCode(line.item_code);
    if (!code) return;
    afterMap.set(code, {
      item_code: code,
      item_name: String(line.item_name || code),
      quantity: toNumber(line.quantity),
      rate: toNumber(line.rate),
    });
  });

  const allCodes = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes = [];

  allCodes.forEach((code) => {
    const before = beforeMap.get(code) || null;
    const after = afterMap.get(code) || null;

    if (!before && after) {
      changes.push({
        type: 'ADDED',
        item_code: code,
        item_name: after.item_name,
        before_quantity: 0,
        after_quantity: after.quantity,
        before_rate: 0,
        after_rate: after.rate,
      });
      return;
    }

    if (before && !after) {
      changes.push({
        type: 'REMOVED',
        item_code: code,
        item_name: before.item_name,
        before_quantity: before.quantity,
        after_quantity: 0,
        before_rate: before.rate,
        after_rate: 0,
      });
      return;
    }

    if (!before || !after) return;

    const qtyChanged = before.quantity !== after.quantity;
    const rateChanged = before.rate !== after.rate;
    if (!qtyChanged && !rateChanged) return;

    changes.push({
      type: 'UPDATED',
      item_code: code,
      item_name: after.item_name || before.item_name,
      before_quantity: before.quantity,
      after_quantity: after.quantity,
      before_rate: before.rate,
      after_rate: after.rate,
    });
  });

  return changes.sort((a, b) => String(a.item_code).localeCompare(String(b.item_code)));
}

export function useOrder({ analytics, quickOrderAllItems, selectedCustomer, priceList, setError, setMessage, accessScope = null, editOrderId = '' }) {
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
    () => buildOrderItems(orderQuantities, analytics, quickOrderAllItems),
    [analytics, orderQuantities, quickOrderAllItems]
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

      const location = await requireGpsLocation();
      const nowIso = new Date().toISOString();

      let existingLines = [];
      if (draftOrderId) {
        const { data: beforeLines, error: beforeLinesError } = await supabase
          .from('sales_order_items')
          .select('item_code,item_name,quantity,rate')
          .eq('order_id', draftOrderId);

        if (beforeLinesError) throw beforeLinesError;
        existingLines = beforeLines || [];
      }

      let orderId = draftOrderId;
      if (!orderId) {
        const { data: newOrder, error: orderError } = await supabase
          .from('sales_orders')
          .insert({
            customer_code: selectedCustomer.customer_code,
            customer_name: selectedCustomer.customer_name,
            salesman_code: selectedCustomer.current_salesman_code,
            status: 'DRAFT',
            created_by: session.user.id,
            updated_at: nowIso,
          })
          .select('id')
          .single();

        if (orderError) throw orderError;
        orderId = newOrder.id;
        setDraftOrderId(orderId);
      } else {
        const { error: updateError } = await supabase
          .from('sales_orders')
          .update({
            customer_name: selectedCustomer.customer_name,
            salesman_code: selectedCustomer.current_salesman_code,
            updated_at: nowIso,
          })
          .eq('id', orderId);

        if (updateError) throw updateError;
      }

      const { error: deleteError } = await supabase.from('sales_order_items').delete().eq('order_id', orderId);
      if (deleteError) throw deleteError;

      const lines = orderItems.map((item) => ({
        order_id: orderId,
        item_code: item.item_code,
        item_name: item.item_name,
        category: item.category,
        quantity: Number(item.order_quantity),
        rate: Number(getPrice(priceList, item.item_code) || 0),
        line_value: Number(getPrice(priceList, item.item_code) || 0) * Number(item.order_quantity),
      }));

      const { error: lineError } = await supabase.from('sales_order_items').insert(lines);
      if (lineError) throw lineError;

      const changeSet = buildChangeSet(
        existingLines,
        lines.map((line) => ({
          item_code: line.item_code,
          item_name: line.item_name,
          quantity: line.quantity,
          rate: line.rate,
        }))
      );

      const action = draftOrderId ? 'EDITED_ORDER' : 'CREATED_ORDER';
      const historyResponse = await fetch('/api/order-history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          orderId,
          changedAt: nowIso,
          action,
          previousStatus: loadedOrderStatus || 'DRAFT',
          nextStatus: loadedOrderStatus || 'DRAFT',
          changes: changeSet,
        }),
      });

      const historyPayload = await historyResponse.json().catch(() => ({}));
      if (historyResponse.ok && historyPayload.success) {
        setOrderHistory(Array.isArray(historyPayload.history) ? historyPayload.history : []);
      }

      await insertGpsActivityLog(
        supabase,
        session.user.id,
        draftOrderId ? 'ORDER_EDITED' : 'ORDER_DRAFT',
        location,
        {
          order_id: orderId,
          customer_code: selectedCustomer.customer_code,
          customer_name: selectedCustomer.customer_name,
        },
      );

      setMessage('Draft order saved successfully.');
      return orderId;
    } catch (err) {
      setError(err.message || 'Unable to save draft order.');
      return null;
    } finally {
      setSavingOrder(false);
    }
  }, [draftOrderId, orderItems, priceList, selectedCustomer, selectedQuantityCount, setError, setMessage]);

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
      const orderId = await saveDraft();
      if (!orderId) throw new Error('Unable to save the order before submission.');

      const nowIso = new Date().toISOString();

      const { error: submitError } = await supabase
        .from('sales_orders')
        .update({
          status: 'SUBMITTED',
          submitted_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', orderId);

      if (submitError) throw submitError;

      const { data: { session } } = await supabase.auth.getSession();
      const location = await requireGpsLocation();
      if (session?.user?.id) {
        await insertGpsActivityLog(supabase, session.user.id, 'ORDER_SUBMITTED', location, {
          order_id: orderId,
          customer_code: selectedCustomer?.customer_code || '',
        });
      }

      if (session?.access_token) {
        const historyResponse = await fetch('/api/order-history', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            orderId,
            changedAt: nowIso,
            action: 'SUBMITTED_ORDER',
            previousStatus: loadedOrderStatus || 'DRAFT',
            nextStatus: 'SUBMITTED',
            changes: [],
          }),
        });

        const historyPayload = await historyResponse.json().catch(() => ({}));
        if (historyResponse.ok && historyPayload.success) {
          setOrderHistory(Array.isArray(historyPayload.history) ? historyPayload.history : []);
        }
      }

      setMessage(`Order #${orderId} submitted successfully.`);
      setShowOrderReview(false);
      setLoadedOrderStatus('SUBMITTED');
      return orderId;
    } catch (err) {
      setError(err.message || 'Unable to submit order.');
      return null;
    } finally {
      setSubmittingOrder(false);
    }
  }, [loadedOrderStatus, orderItems.length, saveDraft, selectedCustomer, selectedQuantityCount, setError, setMessage]);

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
