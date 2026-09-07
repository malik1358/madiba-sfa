-- Share Ahmed Nabil's current customers with Abdalla Anthanath.
-- Ahmed stays the assigned salesman. Both can see the accounts.
-- Run in the Supabase SQL editor if My Day still hides these rows after deploy
-- (direct client queries use RLS on current/previous salesman).

UPDATE public.customers
SET
  previous_salesman_code = 'ABDALLA',
  updated_at = now()
WHERE upper(trim(regexp_replace(coalesce(current_salesman_code, ''), '\s+', ' ', 'g'))) = 'AHMED NABIL'
  AND (
    previous_salesman_code IS NULL
    OR trim(previous_salesman_code) = ''
    OR upper(trim(regexp_replace(previous_salesman_code, '\s+', ' ', 'g')))
      IN ('ABDALLA', 'ABADALLA', 'ABDALLA ANTHANATH', 'ABADALLA ANTHANATH')
  );
