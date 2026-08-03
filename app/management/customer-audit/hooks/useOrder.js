import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase';
import { buildOrderItems, buildOrderSummary, changeOrderQty, decreaseOrderQty, increaseOrderQty } from '../lib/orderHelpers';
import { getPrice } from '../lib/helpers';

export function useOrder({ analytics, quickOrderAllItems, selectedCustomer, priceList, setError, setMessage }) {
  const [draftOrderId, setDraftOrderId] = useState(null);
  const [orderQuantities, setOrderQuantities] = useState({});
  const [savingOrder, setSavingOrder] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [showOrderReview, setShowOrderReview] = useState(false);

  const orderItems = useMemo(
    () => buildOrderItems(orderQuantities, analytics, quickOrderAllItems),
    [analytics, orderQuantities, quickOrderAllItems]
  );

  const orderSummary = useMemo(() => buildOrderSummary(orderItems), [orderItems]);

  useEffect(() => {
    async function loadDraftOrder() {
      if (!selectedCustomer) {
        setDraftOrderId(null);
        setOrderQuantities({});
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data: draft, error: draftError } = await supabase
          .from('sales_orders')
          .select('id, customer_code, status, created_by')
          .eq('customer_code', selectedCustomer.customer_code)
          .eq('status', 'DRAFT')
          .eq('created_by', session.user.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (draftError) throw draftError;

        if (!draft) {
          setDraftOrderId(null);
          setOrderQuantities({});
          return;
        }

        setDraftOrderId(draft.id);
        const { data: lines, error: lineError } = await supabase
          .from('sales_order_items')
          .select('item_code, quantity')
          .eq('order_id', draft.id);

        if (lineError) throw lineError;

        const loadedQuantities = {};
        (lines || []).forEach((line) => {
          loadedQuantities[line.item_code] = Number(line.quantity || 0);
        });

        setOrderQuantities(loadedQuantities);
      } catch (err) {
        setError(err.message || 'Unable to restore draft order.');
      }
    }

    loadDraftOrder();
  }, [selectedCustomer, setError]);

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
      setError('Add at least one item before saving the draft.');
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
            updated_at: new Date().toISOString(),
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

      setMessage('Draft order saved successfully.');
      return orderId;
    } catch (err) {
      setError(err.message || 'Unable to save draft order.');
      return null;
    } finally {
      setSavingOrder(false);
    }
  }, [draftOrderId, orderItems, priceList, selectedCustomer, setError, setMessage]);

  const submitOrder = useCallback(async () => {
    if (orderItems.length === 0) {
      setError('Add at least one item before submitting the order.');
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setSubmittingOrder(true);
    setError('');
    setMessage('');

    try {
      const orderId = await saveDraft();
      if (!orderId) throw new Error('Unable to save the order before submission.');

      const { error: submitError } = await supabase
        .from('sales_orders')
        .update({
          status: 'SUBMITTED',
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (submitError) throw submitError;

      setMessage(`Order #${orderId} submitted successfully.`);
      setShowOrderReview(false);
      setDraftOrderId(null);
      setOrderQuantities({});
    } catch (err) {
      setError(err.message || 'Unable to submit order.');
    } finally {
      setSubmittingOrder(false);
    }
  }, [orderItems.length, saveDraft, setError, setMessage]);

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
    updateQty,
    increaseQty,
    decreaseQty,
    saveDraft,
    submitOrder,
  };
}
