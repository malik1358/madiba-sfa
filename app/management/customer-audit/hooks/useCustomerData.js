import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase';
import { fetchSalesScope } from '../../../lib/salesScope';

const PEER_HISTORY_MONTHS = 18;
const PEER_HISTORY_LIMIT = 20000;
const CUSTOMER_HISTORY_LIMIT = 5000;

async function fetchVisibleCustomers(token) {
  const response = await fetch('/api/customers/visible', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Unable to load visible customers.');
  }

  return payload.customers || [];
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function canUseCrossSalesHistory(accessScope, customer) {
  if (!customer) return false;
  if (accessScope?.hasAllAccess) return true;

  const mutualCodes = Array.isArray(accessScope?.mutualSalesmanCodes)
    ? accessScope.mutualSalesmanCodes.map((code) => normalizeCode(code)).filter(Boolean)
    : [];

  if (mutualCodes.length === 0) return false;
  return mutualCodes.includes(normalizeCode(customer.current_salesman_code));
}

function historyCutoffIso(monthsBack = PEER_HISTORY_MONTHS) {
  const now = new Date();
  now.setMonth(now.getMonth() - monthsBack);
  return now.toISOString().slice(0, 10);
}

export function useCustomerData({ setError, setMessage }) {
  const [customers, setCustomers] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [selectedSalesman, setSelectedSalesman] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [peerTransactions, setPeerTransactions] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [itemMasterStatus, setItemMasterStatus] = useState('Not loaded');
  const [loading, setLoading] = useState(true);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [accessScope, setAccessScope] = useState(null);

  const loadFoundation = useCallback(async () => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Please login again.');
      }

      const scope = await fetchSalesScope();
      setAccessScope(scope);

      const list = await fetchVisibleCustomers(session.access_token);
      setCustomers(list);

      const { data: masterData, error: masterError } = await supabase
        .from('items_master')
        .select('*');

      if (masterError) {
        setItemMasterStatus(`ERROR: ${masterError.message}`);
        setItemMaster([]);
      } else {
        setItemMasterStatus(`SUCCESS: ${masterData?.length || 0} rows`);
        setItemMaster(masterData || []);
      }

      const salesmanCodes = [
        ...new Set((scope.visibleMembers || []).map((member) => member.salesman_code).filter(Boolean)),
      ].sort();

      setSalesmen(salesmanCodes);
    } catch (err) {
      setError(err.message || 'Unable to load customer data.');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  const openCustomer = useCallback(async (customer) => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setSelectedCustomer(customer);
    setTransactions([]);
    setPeerTransactions([]);
    setLoadingCustomer(true);
    setShowTransactions(false);
    setExpandedCategories({});
    setError('');
    setMessage('');

    try {
      const cutoffDate = historyCutoffIso();

      const { data, error: salesError } = await supabase
        .from('sales_raw')
        .select(`
          id,
          transaction_date,
          voucher_number,
          reference,
          customer_code,
          customer_name,
          salesman_code,
          salesman_name,
          item_code,
          item_name,
          category,
          quantity,
          sales_amount,
          rate,
          first_purchase_date,
          abc_class
        `)
        .eq('customer_code', customer.customer_code)
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(CUSTOMER_HISTORY_LIMIT);

      if (salesError) throw salesError;
      setTransactions(data || []);

      let peerQuery = supabase
        .from('sales_raw')
        .select(`
          customer_code,
          item_code,
          item_name,
          category,
          sales_amount,
          transaction_date
          `)
        .gte('transaction_date', cutoffDate)
        .order('transaction_date', { ascending: false })
        .limit(PEER_HISTORY_LIMIT);

      const allowCrossSalesHistory = canUseCrossSalesHistory(accessScope, customer);

      if (!accessScope?.hasAllAccess && !allowCrossSalesHistory) {
        peerQuery = peerQuery.in('salesman_code', accessScope?.visibleSalesmanCodes || []);
      }

      const { data: peerData, error: peerError } = await peerQuery;

      if (peerError) throw peerError;
      setPeerTransactions(peerData || []);
    } catch (err) {
      setError(err.message || 'Unable to load customer history.');
    } finally {
      setLoadingCustomer(false);
    }
  }, [accessScope, setError, setMessage]);

  const toggleCategory = useCallback((category) => {
    setExpandedCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }, []);

  const closeCustomer = useCallback(() => {
    setSelectedCustomer(null);
    setTransactions([]);
    setPeerTransactions([]);
    setShowTransactions(false);
    setExpandedCategories({});
    setError('');
    setMessage('');
  }, [setError, setMessage]);

  useEffect(() => {
    loadFoundation();
  }, [loadFoundation]);

  return {
    customers,
    salesmen,
    selectedSalesman,
    setSelectedSalesman,
    search,
    setSearch,
    selectedCustomer,
    transactions,
    peerTransactions,
    itemMaster,
    itemMasterStatus,
    loading,
    loadingCustomer,
    showTransactions,
    setShowTransactions,
    expandedCategories,
    toggleCategory,
    openCustomer,
    closeCustomer,
    accessScope,
  };
}
