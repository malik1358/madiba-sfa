-- Manual apply (Supabase SQL editor) if migration has not run yet.
-- Same as supabase/migrations/20260908140000_stock_take.sql

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stock_take_access boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.stock_take_items (
  item_code text PRIMARY KEY,
  item_name text NOT NULL DEFAULT '',
  base_uom text NOT NULL DEFAULT 'PCS',
  mid_uom text NOT NULL DEFAULT 'MID',
  master_uom text NOT NULL DEFAULT 'CTN',
  base_uom_pack_size numeric NOT NULL DEFAULT 0,
  mid_uom_pack_size numeric NOT NULL DEFAULT 0,
  barcode_base text,
  barcode_mid text,
  barcode_master text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS stock_take_items_barcode_base_idx
  ON public.stock_take_items (barcode_base)
  WHERE barcode_base IS NOT NULL AND barcode_base <> '';

CREATE INDEX IF NOT EXISTS stock_take_items_barcode_mid_idx
  ON public.stock_take_items (barcode_mid)
  WHERE barcode_mid IS NOT NULL AND barcode_mid <> '';

CREATE INDEX IF NOT EXISTS stock_take_items_barcode_master_idx
  ON public.stock_take_items (barcode_master)
  WHERE barcode_master IS NOT NULL AND barcode_master <> '';

CREATE TABLE IF NOT EXISTS public.stock_take_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_name text NOT NULL,
  warehouse_key text NOT NULL,
  started_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_by_name text,
  started_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'OPEN'
);

CREATE INDEX IF NOT EXISTS stock_take_sessions_warehouse_idx
  ON public.stock_take_sessions (warehouse_key, started_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_take_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.stock_take_sessions(id) ON DELETE SET NULL,
  warehouse_name text NOT NULL,
  warehouse_key text NOT NULL,
  item_code text NOT NULL,
  item_name text NOT NULL DEFAULT '',
  barcode text,
  scanned_uom text NOT NULL,
  scanned_uom_label text,
  qty_entered numeric NOT NULL,
  qty_base numeric NOT NULL,
  qty_master numeric NOT NULL,
  pallet_ref text,
  location_ref text,
  scanned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  scanned_by_name text,
  scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_take_lines_warehouse_idx
  ON public.stock_take_lines (warehouse_key, scanned_at DESC);

CREATE INDEX IF NOT EXISTS stock_take_lines_user_idx
  ON public.stock_take_lines (scanned_by, scanned_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_take_system_inventory (
  warehouse_key text NOT NULL,
  item_code text NOT NULL,
  item_name text,
  qty_base numeric NOT NULL DEFAULT 0,
  warehouse_name text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (warehouse_key, item_code)
);

ALTER TABLE public.stock_take_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_take_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_take_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_take_system_inventory ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.stock_take_items TO service_role;
GRANT ALL ON public.stock_take_sessions TO service_role;
GRANT ALL ON public.stock_take_lines TO service_role;
GRANT ALL ON public.stock_take_system_inventory TO service_role;
