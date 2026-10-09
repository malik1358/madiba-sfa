ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_latitude double precision,
  ADD COLUMN IF NOT EXISTS home_longitude double precision;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_home_location_pair_check
  CHECK (
    (home_latitude IS NULL AND home_longitude IS NULL)
    OR (
      home_latitude IS NOT NULL
      AND home_longitude IS NOT NULL
      AND
      home_latitude BETWEEN -90 AND 90
      AND home_longitude BETWEEN -180 AND 180
    )
  );

CREATE OR REPLACE FUNCTION public.distance_meters(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_latitude_b double precision,
  p_longitude_b double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 6371000 * 2 * atan2(
    sqrt(
      sin(radians(p_latitude_b - p_latitude_a) / 2) ^ 2
      + cos(radians(p_latitude_a)) * cos(radians(p_latitude_b))
      * sin(radians(p_longitude_b - p_longitude_a) / 2) ^ 2
    ),
    sqrt(1 - (
      sin(radians(p_latitude_b - p_latitude_a) / 2) ^ 2
      + cos(radians(p_latitude_a)) * cos(radians(p_latitude_b))
      * sin(radians(p_longitude_b - p_longitude_a) / 2) ^ 2
    ))
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_home_location_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_latitude double precision;
  event_longitude double precision;
  home_latitude double precision;
  home_longitude double precision;
BEGIN
  IF auth.uid() IS NULL
    OR auth.uid() <> NEW.user_id
    OR NEW.entry_type NOT IN ('MORNING_ATTENDANCE', 'END_OF_DAY')
  THEN
    RETURN NEW;
  END IF;

  SELECT profile.home_latitude, profile.home_longitude
    INTO home_latitude, home_longitude
    FROM public.profiles AS profile
    WHERE profile.id = NEW.user_id;

  IF home_latitude IS NULL OR home_longitude IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    event_latitude := (NEW.note::jsonb #>> '{location,latitude}')::double precision;
    event_longitude := (NEW.note::jsonb #>> '{location,longitude}')::double precision;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'GPS coordinates are required for login or logout attendance.'
      USING ERRCODE = '23514';
  END;

  IF event_latitude IS NULL OR event_longitude IS NULL THEN
    RAISE EXCEPTION 'GPS coordinates are required for login or logout attendance.'
      USING ERRCODE = '23514';
  END IF;

  IF event_latitude IS NOT NULL
    AND event_longitude IS NOT NULL
    AND home_latitude IS NOT NULL
    AND home_longitude IS NOT NULL
    AND public.distance_meters(event_latitude, event_longitude, home_latitude, home_longitude) <= 500
  THEN
    RAISE EXCEPTION 'Login or logout cannot be recorded within 500 m of your saved home location.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_activity_logs_home_location_guard ON public.daily_activity_logs;
CREATE TRIGGER daily_activity_logs_home_location_guard
  BEFORE INSERT ON public.daily_activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_home_location_attendance();

CREATE OR REPLACE FUNCTION public.guard_customer_home_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.home_latitude IS NOT NULL
      AND profile.home_longitude IS NOT NULL
      AND public.distance_meters(
        NEW.latitude,
        NEW.longitude,
        profile.home_latitude,
        profile.home_longitude
      ) <= 25
  ) THEN
    RAISE EXCEPTION 'A customer location cannot be set to a saved salesperson home location.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_home_location_guard ON public.customers;
CREATE TRIGGER customers_home_location_guard
  BEFORE INSERT OR UPDATE OF latitude, longitude ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_home_location();