import { useCallback, useEffect, useState } from 'react';
import { getSessionWithTimeout, withTimeout } from '../../../lib/authSession';
import { getSupabaseClient } from '../../../lib/supabase';
import {
  fetchCustomerHistoryCached,
  fetchItemsMasterCached,
  fetchSalesScopeCached,
  fetchVisibleCustomersCached,
  hydrateFoundationFromCache,
} from '../../../lib/mobileDataCache';
import { dedupeCustomerMasterRows } from '../../../lib/customerMasterQuery';

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
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [accessScope, setAccessScope] = useState(null);

  const LOAD_TIMEOUT_MS = 45000;
  const SESSION_TIMEOUT_MS = 10000;

  const loadFoundation = useCallback(async () => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setRefreshing(false);
    setError('');

    try {
      await withTimeout((async () => {
        const session = await getSessionWithTimeout(supabase, SESSION_TIMEOUT_MS);
        if (!session) {
          throw new Error('Please login again.');
        }

        const hydrated = await hydrateFoundationFromCache(session.user.id);
        if (hydrated) {
          setAccessScope(hydrated.scope);
          setCustomers(dedupeCustomerMasterRows(hydrated.customers));
          setItemMaster(hydrated.itemsMaster);
          setItemMasterStatus(hydrated.itemMasterStatus);
          setSalesmen([
            ...new Set((hydrated.scope.visibleMembers || []).map((member) => member.salesman_code).filter(Boolean)),
          ].sort());
          setLoading(false);
          setRefreshing(true);
        }

        const scopeResult = await fetchSalesScopeCached({
          onUpdate: (freshScope) => {
            setAccessScope(freshScope);
            setRefreshing(false);
          },
        });
        const scope = scopeResult.scope;
        setAccessScope(scope);
        if (scopeResult.fromCache) {
          setRefreshing(true);
        }

        const customersResult = await fetchVisibleCustomersCached(session.access_token, scope, {
          onUpdate: (freshCustomers) => {
            setCustomers(dedupeCustomerMasterRows(Array.isArray(freshCustomers) ? freshCustomers : []));
            setRefreshing(false);
          },
        });
        setCustomers(dedupeCustomerMasterRows(Array.isArray(customersResult.data) ? customersResult.data : []));

        const itemsResult = await fetchItemsMasterCached({
          onUpdate: (freshItems) => {
            setItemMaster(freshItems.rows || []);
            setItemMasterStatus(freshItems.status || 'Not loaded');
            setRefreshing(false);
          },
        });
        setItemMaster(itemsResult.data.rows || []);
        setItemMasterStatus(itemsResult.data.status || 'Not loaded');

        const salesmanCodes = [
          ...new Set((scope.visibleMembers || []).map((member) => member.salesman_code).filter(Boolean)),
        ].sort();

        setSalesmen(salesmanCodes);
      })(), LOAD_TIMEOUT_MS, 'Customer data load timed out. Please refresh the page or login again.');
    } catch (err) {
      const message = String(err.message || '');
      if (message === 'SESSION_TIMEOUT') {
        setError('Session check timed out. Please refresh the page or login again.');
      } else {
        setError(message || 'Unable to load customer data.');
      }
    } finally {
      setRefreshing(false);
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
    setExpandedCategories({});
    setError('');
    setMessage('');

    try {
      const session = await getSessionWithTimeout(supabase, SESSION_TIMEOUT_MS);
      if (!session?.access_token) {
        throw new Error('Please login again.');
      }

      const scope = accessScope || (await fetchSalesScopeCached()).scope;
      const historyResult = await fetchCustomerHistoryCached(
        session.access_token,
        scope,
        customer.customer_code,
        {
          onUpdate: (freshHistory) => {
            setTransactions(freshHistory.transactions || []);
            setPeerTransactions(freshHistory.peerTransactions || []);
          },
        },
      );

      setTransactions(historyResult.data.transactions || []);
      setPeerTransactions(historyResult.data.peerTransactions || []);
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
    refreshing,
    expandedCategories,
    toggleCategory,
    openCustomer,
    closeCustomer,
    accessScope,
  };
}
