export function withTimeout(promise, timeoutMs, timeoutMessage = "REQUEST_TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

export async function getSessionWithTimeout(supabase, timeoutMs = 10000) {
  const { data, error } = await withTimeout(
    supabase.auth.getSession(),
    timeoutMs,
    "SESSION_TIMEOUT",
  );

  if (error) throw error;
  return data?.session || null;
}

export function waitForInitialSession(supabase, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription = null;

    const finish = (session, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.unsubscribe();
      if (error) reject(error);
      else resolve(session || null);
    };

    const timer = setTimeout(() => {
      finish(null, new Error("SESSION_TIMEOUT"));
    }, timeoutMs);

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN" && event !== "SIGNED_OUT") {
        return;
      }
      finish(session || null);
    });

    subscription = authSubscription;

    getSessionWithTimeout(supabase, timeoutMs)
      .then((session) => finish(session))
      .catch((error) => finish(null, error));
  });
}

let sharedSessionPromise = null;
let sharedSessionCache = { session: undefined, at: 0 };

export async function resolveAuthSession(supabase, timeoutMs = 8000) {
  if (!supabase) return null;

  const now = Date.now();
  if (sharedSessionCache.session !== undefined && now - sharedSessionCache.at < 4000) {
    return sharedSessionCache.session;
  }

  if (sharedSessionPromise) {
    return sharedSessionPromise;
  }

  sharedSessionPromise = (async () => {
    try {
      const session = await withTimeout(
        Promise.race([
          getSessionWithTimeout(supabase, timeoutMs),
          waitForInitialSession(supabase, timeoutMs),
        ]),
        timeoutMs + 1000,
        "SESSION_TIMEOUT",
      );
      sharedSessionCache = { session, at: Date.now() };
      return session;
    } catch (error) {
      if (String(error?.message || "") === "SESSION_TIMEOUT") {
        sharedSessionCache = { session: null, at: Date.now() };
        return null;
      }
      throw error;
    } finally {
      sharedSessionPromise = null;
    }
  })();

  return sharedSessionPromise;
}

export function clearAuthSessionCache() {
  sharedSessionCache = { session: undefined, at: 0 };
  sharedSessionPromise = null;
}

export async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Request timed out. Please refresh and try again.");
    }
    if (error instanceof TypeError || String(error?.message || "").includes("NetworkError")) {
      throw new Error("Unable to reach the server. Restart dev server and refresh the page.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
