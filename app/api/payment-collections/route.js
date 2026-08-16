import { createClient } from "@supabase/supabase-js";
import { buildCollectionQueues } from "../../lib/paymentCollections.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || message.includes("relation") && message.includes("does not exist");
}

async function getAuthUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("No authorization header provided");
  }

  const token = authHeader.slice(7);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unable to verify user session");
  return user;
}

async function getSalesScope(admin, userId) {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!profile) throw new Error("No profile found for this user");

  let visibleSalesmanCodes = [];
  let hasAllAccess = false;

  const userRole = String(profile?.role || "").toLowerCase();
  const normalizedProfileCode = String(profile.salesman_code || "").trim().toUpperCase();
  
  // Admins and managers see all customers
  if (userRole === "admin" || userRole === "manager") {
    hasAllAccess = true;
    visibleSalesmanCodes = [];
  } 
  // Collectors with a salesman code see their customers
  else if (userRole === "collector" && normalizedProfileCode) {
    visibleSalesmanCodes = [normalizedProfileCode];
  }
  // Regular salesmen - check if they have subordinates
  else if (normalizedProfileCode) {
    try {
      const { data: allAuthUsers, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      
      if (!usersError && allAuthUsers?.users) {
        const subordinateCodes = [normalizedProfileCode];
        
        // Find all users who report to this salesman
        for (const authU of allAuthUsers.users) {
          const metadata = authU?.user_metadata || authU?.app_metadata || {};
          const subHeadCode = String(metadata.head_salesman_code || "").trim().toUpperCase();
          
          if (subHeadCode === normalizedProfileCode) {
            const { data: subProfile } = await admin
              .from("profiles")
              .select("salesman_code")
              .eq("id", authU.id)
              .maybeSingle();
            
            if (subProfile?.salesman_code) {
              subordinateCodes.push(subProfile.salesman_code);
            }
          }
        }
        
        visibleSalesmanCodes = subordinateCodes;
      } else {
        visibleSalesmanCodes = [normalizedProfileCode];
      }
    } catch (e) {
      // If subordinate lookup fails, just use their own code
      visibleSalesmanCodes = [normalizedProfileCode];
    }
  }

  return {
    visibleSalesmanCodes: [...new Set(visibleSalesmanCodes.filter(Boolean))],
    identitySearchPatterns: [profile.salesman_code],
    hasAllAccess,
    userRole,
  };
}

async function fetchOutstandingAndCollectionRecords(admin, scope) {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Server configuration is incomplete");
  }

  const normalizedScopeCodes = new Set((scope.visibleSalesmanCodes || []).map((code) => normalizeCode(code)).filter(Boolean));

  // Fetch customers assigned to the salesman
  let customerQuery = admin
    .from("customers")
    .select("customer_code,customer_name,current_salesman_code,city,area")
    .eq("is_active", true);

  if (!scope.hasAllAccess && normalizedScopeCodes.size > 0) {
    customerQuery = customerQuery.in("current_salesman_code", Array.from(normalizedScopeCodes));
  }

  const { data: customers, error: customersError } = await customerQuery;
  if (customersError) throw customersError;

  // Fetch salesman names from profiles
  const { data: salesmen, error: salesmenError } = await admin
    .from("profiles")
    .select("salesman_code,salesman_name");

  if (salesmenError) throw salesmenError;

  const salesmanMap = new Map();
  (salesmen || []).forEach((salesman) => {
    const normalizedCode = normalizeCode(salesman.salesman_code);
    salesmanMap.set(normalizedCode, salesman.salesman_name);
  });

  // Fetch all invoices
  let invoices = [];
  {
    const { data, error } = await admin
      .from("invoices")
      .select("customer_code,invoice_number,due_date,pending_amount,ref_no");

    if (error && !isMissingTableError(error)) throw error;
    invoices = Array.isArray(data) ? data : [];
  }

  // Fetch collection visit history
  let visits = [];
  {
    const { data, error } = await admin
      .from("collection_visits")
      .select("customer_code,visit_outcome,payment_status,amount_received,receipt_mode,next_visit_at,remark_arabic,remark_english,saved_at")
      .order("customer_code")
      .order("saved_at", { ascending: false });

    if (error && !isMissingTableError(error)) throw error;
    visits = Array.isArray(data) ? data : [];
  }

  // Fetch legal transfers
  let legalTransfers = [];
  {
    const { data, error } = await admin
      .from("legal_transfers")
      .select("customer_code,is_transferred,transferred_at,note");

    if (error && !isMissingTableError(error)) throw error;
    legalTransfers = Array.isArray(data) ? data : [];
  }

  // Build customer records with outstanding and collection data
  const visitsByCustomer = new Map();
  const legalTransfersByCustomer = new Map();

  (visits || []).forEach((visit) => {
    if (!visitsByCustomer.has(visit.customer_code)) {
      visitsByCustomer.set(visit.customer_code, []);
    }
    visitsByCustomer.get(visit.customer_code).push(visit);
  });

  (legalTransfers || []).forEach((transfer) => {
    if (!legalTransfersByCustomer.has(transfer.customer_code)) {
      legalTransfersByCustomer.set(transfer.customer_code, transfer);
    }
  });

  const invoicesByCustomer = new Map();
  (invoices || []).forEach((invoice) => {
    if (!invoicesByCustomer.has(invoice.customer_code)) {
      invoicesByCustomer.set(invoice.customer_code, []);
    }
    invoicesByCustomer.get(invoice.customer_code).push(invoice);
  });

  const records = (customers || []).map((customer) => {
    const customerInvoices = invoicesByCustomer.get(customer.customer_code) || [];
    const visits = visitsByCustomer.get(customer.customer_code) || [];
    const legalTransfer = legalTransfersByCustomer.get(customer.customer_code);

    // Calculate outstanding amounts
    const outstanding = {
      outstanding_cash: 0,
      outstanding_0_30: 0,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
    };

    const today = new Date();
    customerInvoices.forEach((invoice) => {
      const pendingAmount = Number(invoice.pending_amount || 0);
      if (pendingAmount <= 0) return;

      const dueDate = new Date(invoice.due_date);
      const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

      if (/C/i.test(String(invoice.ref_no || ""))) {
        outstanding.outstanding_cash += pendingAmount;
      } else if (daysOverdue <= 30) {
        outstanding.outstanding_0_30 += pendingAmount;
      } else if (daysOverdue <= 60) {
        outstanding.outstanding_30_60 += pendingAmount;
      } else if (daysOverdue <= 90) {
        outstanding.outstanding_61_90 += pendingAmount;
      } else if (daysOverdue <= 120) {
        outstanding.outstanding_91_120 += pendingAmount;
      } else {
        outstanding.outstanding_above_120 += pendingAmount;
      }
    });

    return {
      customer_code: customer.customer_code,
      customer_name: customer.customer_name,
      current_salesman_code: customer.current_salesman_code,
      salesman_name: salesmanMap.get(normalizeCode(customer.current_salesman_code)) || customer.current_salesman_code,
      city: customer.city,
      area: customer.area,
      invoices: customerInvoices,
      latest_collection: visits[0] || null,
      legal_transfer: legalTransfer || null,
      ...outstanding,
    };
  });

  return records;
}

export async function GET(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 }
      );
    }

    const user = await getAuthUser(request);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await getSalesScope(admin, user.id);
    const records = await fetchOutstandingAndCollectionRecords(admin, scope);
    const queues = buildCollectionQueues(records);

    return Response.json({
      success: true,
      dueCustomers: queues.dueCustomers,
      legalCustomers: queues.legalCustomers,
    });
  } catch (error) {
    console.error("Error fetching payment collections:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to load payment collection queue" },
      { status: 400 }
    );
  }
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceKey) {
      return Response.json(
        { success: false, error: "Server configuration is incomplete" },
        { status: 500 }
      );
    }

    const user = await getAuthUser(request);
    const formData = await request.formData();

    const customerCode = normalizeCode(formData.get("customerCode") || "");
    const visitOutcome = String(formData.get("visitOutcome") || "").trim();
    const paymentStatus = String(formData.get("paymentStatus") || "").trim();
    const amountReceived = Number(formData.get("amountReceived") || 0);
    const receiptMode = String(formData.get("receiptMode") || "").trim();
    const nextVisitAt = String(formData.get("nextVisitAt") || "").trim();
    const remarkArabic = String(formData.get("remarkArabic") || "").trim();
    const remarkEnglish = String(formData.get("remarkEnglish") || "").trim();
    const nonPaymentReason = String(formData.get("nonPaymentReason") || "").trim();
    const legalNote = String(formData.get("legalNote") || "").trim();

    if (!customerCode) throw new Error("Customer code is required");
    if (!visitOutcome) throw new Error("Please select visit outcome");

    if (visitOutcome === "FUNDS_RECEIVED" && amountReceived <= 0) {
      throw new Error("Amount received is required for funds received outcome");
    }
    if (visitOutcome === "FUNDS_RECEIVED" && !receiptMode) {
      throw new Error("Mode of receipt is required for funds received outcome");
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scope = await getSalesScope(admin, user.id);
    const normalizedScopeCodes = new Set((scope.visibleSalesmanCodes || []).map((code) => normalizeCode(code)).filter(Boolean));

    // Verify user has access to this customer
    if (!scope.hasAllAccess && normalizedScopeCodes.size > 0) {
      const { data: customer, error: customerError } = await admin
        .from("customers")
        .select("current_salesman_code")
        .eq("customer_code", customerCode)
        .maybeSingle();

      if (customerError) throw customerError;
      if (!customer || !normalizedScopeCodes.has(normalizeCode(customer.current_salesman_code))) {
        throw new Error("You do not have access to this customer");
      }
    }

    // Handle file uploads for payment and receipt copies
    let paymentCopyUrl = null;
    let receiptCopyUrl = null;

    const paymentCopyFile = formData.get("paymentCopy");
    if (paymentCopyFile && paymentCopyFile.size > 0) {
      const paymentCopyPath = `payment-copies/${customerCode}-${Date.now()}-payment.jpg`;
      const { data: paymentData, error: paymentError } = await admin.storage
        .from("payment-collections")
        .upload(paymentCopyPath, paymentCopyFile, { upsert: true });

      if (paymentError) throw paymentError;
      paymentCopyUrl = `${supabaseUrl}/storage/v1/object/public/payment-collections/${paymentData.path}`;
    }

    const receiptCopyFile = formData.get("receiptCopy");
    if (receiptCopyFile && receiptCopyFile.size > 0) {
      const receiptCopyPath = `receipt-copies/${customerCode}-${Date.now()}-receipt.jpg`;
      const { data: receiptData, error: receiptError } = await admin.storage
        .from("payment-collections")
        .upload(receiptCopyPath, receiptCopyFile, { upsert: true });

      if (receiptError) throw receiptError;
      receiptCopyUrl = `${supabaseUrl}/storage/v1/object/public/payment-collections/${receiptData.path}`;
    }

    // Insert new collection visit
    const { data: insertData, error: insertError } = await admin
      .from("collection_visits")
      .insert({
        customer_code: customerCode,
        visit_outcome: visitOutcome,
        payment_status: paymentStatus,
        amount_received: amountReceived,
        receipt_mode: receiptMode,
        next_visit_at: nextVisitAt || null,
        remark_arabic: remarkArabic,
        remark_english: remarkEnglish,
        non_payment_reason: nonPaymentReason,
        payment_copy_url: paymentCopyUrl,
        receipt_copy_url: receiptCopyUrl,
        created_by: user.id,
        saved_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      if (isMissingTableError(insertError)) {
        throw new Error("Collection tables are not initialized in this environment yet.");
      }
      throw insertError;
    }

    // Update legal transfer if needed
    if (visitOutcome === "TRANSFER_TO_LEGAL") {
      const { error: legalError } = await admin
        .from("legal_transfers")
        .upsert({
          customer_code: customerCode,
          is_transferred: true,
          transferred_at: new Date().toISOString(),
          transferred_by: user.id,
          note: legalNote,
        }, { onConflict: "customer_code" });

      if (legalError) {
        if (isMissingTableError(legalError)) {
          throw new Error("Collection tables are not initialized in this environment yet.");
        }
        throw legalError;
      }
    }

    return Response.json({
      success: true,
      message: "Collection visit saved successfully",
      visitId: insertData?.id,
    });
  } catch (error) {
    console.error("Error saving collection visit:", error);
    return Response.json(
      { success: false, error: error.message || "Unable to save collection visit" },
      { status: 400 }
    );
  }
}
