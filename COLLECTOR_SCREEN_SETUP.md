# Salesman Collector Screen Implementation

## Overview
Added a dedicated collector screen for salesmen that displays only their assigned customers, allowing them to track collections and manage payment status.

## Changes Made

### 1. **New API Route** - `/app/api/payment-collections/route.js`
   - **GET endpoint**: Fetches collection queue filtered by salesman's assigned customers
   - **POST endpoint**: Saves collection visit records with access control
   - **Features**:
     - Automatically filters customers based on user's sales scope
     - Fetches invoices, outstanding amounts, and collection history
     - Calculates aging buckets (0-30, 31-60, 61-90, 91-120, >120 days)
     - Supports file uploads for payment and receipt copies
     - Enforces access control - users can only edit customers assigned to them

### 2. **New Page** - `/app/management/my-collections/page.js`
   - Displays the collection queue for the logged-in salesman
   - Reuses the existing PaymentCollectionsView component
   - Shows only customers assigned to their sales scope
   - Same features as admin collection view but restricted to their customers

### 3. **Updated Management Dashboard** - `/app/management/page.js`
   - Added conditional navigation:
     - Salesmen see "My Customer Collections" link
     - Admins/Managers see "Payment Collections" link (view all customers)

### 4. **Updated Navigation** - `/app/components/MostVisitedPages.jsx`
   - Added "/management/my-collections" to page labels
   - Tracks visits to the salesman collector screen for quick access

## Database Tables Required

The implementation expects the following Supabase tables:

### `customers`
```sql
- customer_code (TEXT, PRIMARY KEY)
- customer_name (TEXT)
- current_salesman_code (TEXT)
- city (TEXT)
- area (TEXT)
- is_active (BOOLEAN)
```

### `invoices`
```sql
- id (UUID)
- customer_code (TEXT)
- invoice_number (TEXT)
- due_date (DATE)
- pending_amount (NUMERIC)
- ref_no (TEXT) -- Used to identify cash transactions
```

### `collection_visits`
```sql
- id (UUID)
- customer_code (TEXT)
- visit_outcome (TEXT) -- e.g., FUNDS_RECEIVED, ASKED_COME_LATER, etc.
- payment_status (TEXT) -- PAID, PARTIAL, NOT_PAID, PROMISED
- amount_received (NUMERIC)
- receipt_mode (TEXT) -- CASH, CHEQUE, BANK_TRANSFER, ATM_MACHINE
- next_visit_at (DATE)
- remark_arabic (TEXT)
- remark_english (TEXT)
- non_payment_reason (TEXT)
- payment_copy_url (TEXT)
- receipt_copy_url (TEXT)
- created_by (UUID)
- saved_at (TIMESTAMP)
```

### `legal_transfers`
```sql
- customer_code (TEXT, PRIMARY KEY)
- is_transferred (BOOLEAN)
- transferred_at (TIMESTAMP)
- transferred_by (UUID)
- note (TEXT)
```

### Storage Bucket
- **Bucket name**: `payment-collections`
- Used for storing payment copy and receipt copy images

## Access Control

- **Salesmen**: See only customers assigned to them (`current_salesman_code` matches their profile)
- **Admins/Managers**: See all customers (no filtering)
- **POST requests**: Verified to ensure user only saves visits for customers in their scope

## How It Works

1. Salesman logs in
2. Navigates to "Management" dashboard
3. Clicks "My Customer Collections"
4. System fetches:
   - All active customers assigned to them
   - Their open invoices
   - Payment history from collection visits
   - Any legal transfers
5. Displays customers in priority order based on:
   - Days overdue
   - Outstanding amount
   - Number of due invoices
   - Last collection outcome
   - Time since last visit
6. Salesman can record:
   - Collection visit outcome
   - Amount received
   - Receipt mode (cash, check, transfer)
   - Next visit date
   - Notes in Arabic and English
   - Payment and receipt copies
7. System saves visit and updates collection history

## Notes

- The same UI component is reused for both admin and salesman views
- Filtering happens automatically based on user's role and sales scope
- All payment copy and receipt files are stored in Supabase storage
- Collection visits are timestamped and tracked by user
- Admin users can override and see all collections from management dashboard
