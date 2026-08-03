import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../lib/supabase';

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

      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select(`
          customer_code,
          customer_name,
          current_salesman_code,
          latest_transaction_date,
          customer_type,
          city,
          area,
          mobile
        `)
        .eq('is_active', true)
        .order('customer_name');

      if (customerError) throw customerError;

      const list = customerData || [];
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
        ...new Set(list.map((customer) => customer.current_salesman_code).filter(Boolean)),
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
      const { data: settings, error: settingsError } = await supabase
        .from('system_settings')
        .select('setting_value')
        .eq('setting_key', 'active_sales_batch_id')
        .single();

      if (settingsError) throw settingsError;

      const activeBatchId = Number(settings.setting_value);
      if (!activeBatchId) throw new Error('No active sales snapshot found.');

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
        .eq('import_batch_id', activeBatchId)
        .eq('customer_code', customer.customer_code)
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: false });

      if (salesError) throw salesError;
      setTransactions(data || []);

      const { data: peerData, error: peerError } = await supabase
        .from('sales_raw')
        .select(`
          customer_code,
          item_code,
          item_name,
          category,
          sales_amount,
          transaction_date
        `)
        .eq('import_batch_id', activeBatchId);

      if (peerError) throw peerError;
      setPeerTransactions(peerData || []);
    } catch (err) {
      setError(err.message || 'Unable to load customer history.');
    } finally {
      setLoadingCustomer(false);
    }
  }, [setError, setMessage]);

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
    setSelectedCustomer,
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
  };
}
