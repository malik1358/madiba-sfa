-- Block customer master pins within 50 m of the MADIBA store, and clear any
-- existing pins already inside that radius (audited as madiba_store_cleanup).

CREATE OR REPLACE FUNCTION public.guard_customer_madiba_store_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  store_lat double precision := 24.56825;
  store_lng double precision := 46.74082;
BEGIN
  IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.latitude IS NOT DISTINCT FROM OLD.latitude
    AND NEW.longitude IS NOT DISTINCT FROM OLD.longitude
  THEN
    RETURN NEW;
  END IF;

  IF public.distance_meters(
    NEW.latitude,
    NEW.longitude,
    store_lat,
    store_lng
  ) <= 50 THEN
    RAISE EXCEPTION 'A customer location cannot be set within 50 m of the MADIBA store.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_madiba_store_location_guard ON public.customers;
CREATE TRIGGER customers_madiba_store_location_guard
  BEFORE INSERT OR UPDATE OF latitude, longitude ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_madiba_store_location();

-- Clear existing pins already inside the store radius (with GPS history).
DO $$
DECLARE
  store_lat double precision := 24.56825;
  store_lng double precision := 46.74082;
  cleared_at timestamptz := timezone('utc', now());
  row_record record;
BEGIN
  FOR row_record IN
    SELECT
      customer_code,
      latitude,
      longitude
    FROM public.customers
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND public.distance_meters(latitude, longitude, store_lat, store_lng) <= 50
  LOOP
    INSERT INTO public.customer_gps_history (
      customer_code,
      latitude,
      longitude,
      previous_latitude,
      previous_longitude,
      source,
      updated_by,
      updated_by_name
    ) VALUES (
      row_record.customer_code,
      NULL,
      NULL,
      row_record.latitude,
      row_record.longitude,
      'madiba_store_cleanup',
      NULL,
      'MADIBA store cleanup'
    );

    UPDATE public.customers
    SET
      latitude = NULL,
      longitude = NULL,
      gps_updated_at = cleared_at,
      gps_updated_by = NULL,
      gps_updated_by_name = 'MADIBA store cleanup',
      gps_update_source = 'madiba_store_cleanup',
      updated_at = cleared_at
    WHERE customer_code = row_record.customer_code;
  END LOOP;
END;
$$;
