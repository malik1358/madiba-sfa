-- HR Management module: company staff ledger, monthly payroll feed, leave.
-- Writes go through /api/hr/* (service role, admin|manager only). Authenticated management
-- users may SELECT directly under RLS. Staff rows are NOT the same as public.profiles:
-- profile_id is an optional link so My Day attendance can prefill a month.
-- Apply in Supabase before deploying the HR screens.

CREATE TABLE IF NOT EXISTS public.hr_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code text NOT NULL,
  full_name text NOT NULL,
  full_name_ar text NOT NULL DEFAULT '',
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  designation text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  nationality text NOT NULL DEFAULT '',
  iqama_no text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  join_date date,
  status text NOT NULL DEFAULT 'ACTIVE',
  basic_salary numeric(14,2) NOT NULL DEFAULT 0,
  housing_allowance numeric(14,2) NOT NULL DEFAULT 0,
  transport_allowance numeric(14,2) NOT NULL DEFAULT 0,
  other_allowance numeric(14,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_employees_code_nonempty CHECK (length(trim(employee_code)) > 0),
  CONSTRAINT hr_employees_name_nonempty CHECK (length(trim(full_name)) > 0),
  CONSTRAINT hr_employees_status_check CHECK (status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text])),
  CONSTRAINT hr_employees_code_key UNIQUE (employee_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS hr_employees_profile_id_key
  ON public.hr_employees (profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS hr_employees_status_idx ON public.hr_employees (status);
CREATE INDEX IF NOT EXISTS hr_employees_department_idx ON public.hr_employees (department);

CREATE TABLE IF NOT EXISTS public.hr_monthly_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  month text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  source text NOT NULL DEFAULT 'MANUAL',
  -- Earnings
  basic_salary numeric(14,2) NOT NULL DEFAULT 0,
  housing_allowance numeric(14,2) NOT NULL DEFAULT 0,
  transport_allowance numeric(14,2) NOT NULL DEFAULT 0,
  other_allowance numeric(14,2) NOT NULL DEFAULT 0,
  overtime_amount numeric(14,2) NOT NULL DEFAULT 0,
  bonus_amount numeric(14,2) NOT NULL DEFAULT 0,
  commission_amount numeric(14,2) NOT NULL DEFAULT 0,
  -- Deductions
  absence_deduction numeric(14,2) NOT NULL DEFAULT 0,
  loan_deduction numeric(14,2) NOT NULL DEFAULT 0,
  advance_deduction numeric(14,2) NOT NULL DEFAULT 0,
  penalty_deduction numeric(14,2) NOT NULL DEFAULT 0,
  other_deduction numeric(14,2) NOT NULL DEFAULT 0,
  -- Attendance ledger (Fridays are holidays)
  working_days numeric(6,2) NOT NULL DEFAULT 0,
  present_days numeric(6,2) NOT NULL DEFAULT 0,
  absent_days numeric(6,2) NOT NULL DEFAULT 0,
  leave_days numeric(6,2) NOT NULL DEFAULT 0,
  holiday_days numeric(6,2) NOT NULL DEFAULT 0,
  overtime_hours numeric(8,2) NOT NULL DEFAULT 0,
  -- Net pay = gross_earnings - total_deductions (no statutory GOSI engine)
  gross_earnings numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  net_pay numeric(14,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  finalized_at timestamptz,
  finalized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_monthly_records_month_check CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT hr_monthly_records_status_check CHECK (status = ANY (ARRAY['DRAFT'::text, 'FINAL'::text])),
  CONSTRAINT hr_monthly_records_source_check CHECK (source = ANY (ARRAY['MANUAL'::text, 'IMPORT'::text, 'PREFILL'::text])),
  CONSTRAINT hr_monthly_records_employee_month_key UNIQUE (employee_id, month)
);

CREATE INDEX IF NOT EXISTS hr_monthly_records_month_idx ON public.hr_monthly_records (month);
CREATE INDEX IF NOT EXISTS hr_monthly_records_status_idx ON public.hr_monthly_records (status);

CREATE TABLE IF NOT EXISTS public.hr_leave_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  leave_type text NOT NULL DEFAULT 'ANNUAL',
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(6,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'APPROVED',
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_leave_entries_dates_check CHECK (end_date >= start_date),
  CONSTRAINT hr_leave_entries_type_check CHECK (leave_type = ANY (ARRAY['ANNUAL'::text, 'SICK'::text, 'UNPAID'::text, 'EMERGENCY'::text, 'HAJJ'::text, 'OTHER'::text])),
  CONSTRAINT hr_leave_entries_status_check CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text]))
);

CREATE INDEX IF NOT EXISTS hr_leave_entries_employee_idx ON public.hr_leave_entries (employee_id, start_date);
CREATE INDEX IF NOT EXISTS hr_leave_entries_range_idx ON public.hr_leave_entries (start_date, end_date);

DROP TRIGGER IF EXISTS hr_employees_set_updated_at ON public.hr_employees;
CREATE TRIGGER hr_employees_set_updated_at
  BEFORE UPDATE ON public.hr_employees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS hr_monthly_records_set_updated_at ON public.hr_monthly_records;
CREATE TRIGGER hr_monthly_records_set_updated_at
  BEFORE UPDATE ON public.hr_monthly_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS hr_leave_entries_set_updated_at ON public.hr_leave_entries;
CREATE TRIGGER hr_leave_entries_set_updated_at
  BEFORE UPDATE ON public.hr_leave_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_monthly_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_leave_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.hr_employees FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hr_monthly_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hr_leave_entries FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.hr_employees TO authenticated;
GRANT SELECT ON TABLE public.hr_monthly_records TO authenticated;
GRANT SELECT ON TABLE public.hr_leave_entries TO authenticated;

GRANT ALL ON TABLE public.hr_employees TO service_role;
GRANT ALL ON TABLE public.hr_monthly_records TO service_role;
GRANT ALL ON TABLE public.hr_leave_entries TO service_role;

DROP POLICY IF EXISTS hr_employees_select_management ON public.hr_employees;
CREATE POLICY hr_employees_select_management ON public.hr_employees
  FOR SELECT TO authenticated
  USING ((SELECT public.is_management()));

DROP POLICY IF EXISTS hr_monthly_records_select_management ON public.hr_monthly_records;
CREATE POLICY hr_monthly_records_select_management ON public.hr_monthly_records
  FOR SELECT TO authenticated
  USING ((SELECT public.is_management()));

DROP POLICY IF EXISTS hr_leave_entries_select_management ON public.hr_leave_entries;
CREATE POLICY hr_leave_entries_select_management ON public.hr_leave_entries
  FOR SELECT TO authenticated
  USING ((SELECT public.is_management()));
