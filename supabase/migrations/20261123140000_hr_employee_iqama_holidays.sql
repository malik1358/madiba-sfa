-- HR Employees: Iqama expiry + annual holidays; monthly half-day attendance.
-- Apply in Supabase before the HR screens and iqama-expiry email cron depend on these columns.

ALTER TABLE public.hr_employees
  ADD COLUMN IF NOT EXISTS iqama_expiry date,
  ADD COLUMN IF NOT EXISTS holidays_per_year numeric(6,2) NOT NULL DEFAULT 0;

ALTER TABLE public.hr_monthly_records
  ADD COLUMN IF NOT EXISTS half_days numeric(6,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS hr_employees_iqama_expiry_idx
  ON public.hr_employees (iqama_expiry)
  WHERE iqama_expiry IS NOT NULL;

COMMENT ON COLUMN public.hr_employees.iqama_expiry IS
  'Iqama / ID expiry date; daily cron warns Soyeb/Sohail/Malik when within 30 days (or overdue).';
COMMENT ON COLUMN public.hr_employees.holidays_per_year IS
  'Annual holiday / leave entitlement days for this staff row.';
COMMENT ON COLUMN public.hr_monthly_records.half_days IS
  'Half-day absences (0.5 day each) for the 26th–25th payroll period; editable after Prefill.';
