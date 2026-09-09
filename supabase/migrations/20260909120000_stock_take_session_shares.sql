-- Share an open stock-take session with another Stock Take user.

CREATE TABLE IF NOT EXISTS public.stock_take_session_shares (
  session_id uuid NOT NULL REFERENCES public.stock_take_sessions(id) ON DELETE CASCADE,
  shared_with uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shared_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  shared_by_name text,
  shared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, shared_with)
);

CREATE INDEX IF NOT EXISTS stock_take_session_shares_user_idx
  ON public.stock_take_session_shares (shared_with, session_id);

ALTER TABLE public.stock_take_session_shares ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.stock_take_session_shares TO service_role;
