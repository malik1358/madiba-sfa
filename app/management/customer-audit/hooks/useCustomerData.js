import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase';
import { fetchSalesScope } from '../../../lib/salesScope';

const CUSTOMER_HISTORY_API = '/api/customer-history';

async function fetchVisibleCustomers(token) {
  const response = await fetch('/api/customers/visible', {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'Unable to load visible customers.');
  }

  return payload.customers || [];
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
  const [showTransactions, setShowTransactions] = useState(true);
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
    setShowTransactions(true);
    setExpandedCategories({});
    setError('');
    setMessage('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please login again.');
      }

      const response = await fetch(
        `${CUSTOMER_HISTORY_API}?customerCode=${encodeURIComponent(customer.customer_code)}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Unable to load customer history.');
      }

      setTransactions(Array.isArray(payload.transactions) ? payload.transactions : []);
      setPeerTransactions(Array.isArray(payload.peerTransactions) ? payload.peerTransactions : []);
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
