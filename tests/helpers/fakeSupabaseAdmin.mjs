import { randomUUID } from "node:crypto";

// In-memory stand-in for the Supabase service-role client used by attachment code.
export function createFakeAdmin({
  tables = {},
  missingTables = [],
  missingColumns = {},
  users = {},
  objects = {},
  buckets = {},
} = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const storage = new Map(Object.entries(objects));
  const bucketState = new Map(Object.entries(buckets).map(([name, settings]) => [name, { ...settings }]));
  const calls = { uploads: [], signed: [], downloads: [], inserts: [], updates: [], bucketCreates: [], bucketUpdates: [] };
  let nextId = 1000;

  function missingColumnError(table, column, insert = false) {
    return insert
      ? { code: "PGRST204", message: `Could not find the '${column}' column of '${table}' in the schema cache` }
      : { code: "42703", message: `column ${table}.${column} does not exist` };
  }

  function checkSchema(table, columns = [], insert = false) {
    if (missingTables.includes(table)) {
      return { code: "42P01", message: `relation "public.${table}" does not exist` };
    }
    const missing = (missingColumns[table] || []).find((column) => columns.includes(column));
    return missing ? missingColumnError(table, missing, insert) : null;
  }

  function from(table) {
    const state = { op: "select", columns: [], filters: [], payload: null };
    const rows = () => (data[table] ||= []);
    const matches = (row) => state.filters.every(([kind, column, value]) => (
      kind === "eq" ? String(row[column]) === String(value) : value.map(String).includes(String(row[column]))
    ));
    const project = (row) => {
      if (!row) return row;
      if (!state.columns.length) return { ...row };
      return Object.fromEntries(state.columns.map((column) => [column, row[column] ?? null]));
    };

    function run() {
      if (state.op === "insert") {
        const error = checkSchema(table, Object.keys(state.payload), true)
          || checkSchema(table, state.columns);
        if (error) return { data: null, error };
        const row = { ...state.payload };
        if (row.id === undefined) row.id = table === "attachments" ? randomUUID() : nextId++;
        if (table === "attachments" && rows().some((existing) => existing.storage_provider === row.storage_provider && existing.object_key === row.object_key)) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        rows().push(row);
        calls.inserts.push({ table, row });
        return { data: project(row), error: null };
      }
      if (state.op === "update") {
        const error = checkSchema(table, Object.keys(state.payload));
        if (error) return { data: null, error };
        const changed = rows().filter(matches);
        changed.forEach((row) => Object.assign(row, state.payload));
        calls.updates.push({ table, patch: state.payload, count: changed.length });
        return { data: null, error: null };
      }
      const error = checkSchema(table, state.columns);
      if (error) return { data: null, error };
      return { data: rows().filter(matches).map(project), error: null };
    }

    const builder = {
      select(columns = "") {
        state.columns = String(columns).split(",").map((value) => value.trim()).filter(Boolean);
        return builder;
      },
      insert(payload) {
        state.op = "insert";
        state.payload = payload;
        return builder;
      },
      update(payload) {
        state.op = "update";
        state.payload = payload;
        return builder;
      },
      eq(column, value) {
        state.filters.push(["eq", column, value]);
        return builder;
      },
      in(column, values) {
        state.filters.push(["in", column, values]);
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      async maybeSingle() {
        const result = run();
        if (result.error) return result;
        const value = Array.isArray(result.data) ? result.data[0] || null : result.data;
        return { data: value, error: null };
      },
      async single() {
        const result = await builder.maybeSingle();
        if (!result.error && !result.data) return { data: null, error: { code: "PGRST116", message: "no rows" } };
        return result;
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    data,
    calls,
    storage: {
      objects: storage,
      buckets: bucketState,
      async getBucket(name) {
        const bucket = bucketState.get(name);
        return bucket ? { data: { id: name, ...bucket }, error: null } : { data: null, error: { message: "Bucket not found" } };
      },
      async createBucket(name, settings) {
        calls.bucketCreates.push({ name, settings });
        if (bucketState.has(name)) return { data: null, error: { message: "The resource already exists" } };
        bucketState.set(name, { ...settings });
        return { data: { name }, error: null };
      },
      async updateBucket(name, settings) {
        calls.bucketUpdates.push({ name, settings });
        bucketState.set(name, { ...bucketState.get(name), ...settings });
        return { data: { message: "Successfully updated" }, error: null };
      },
      from(bucket) {
        return {
          async upload(path, body, options = {}) {
            const key = `${bucket}/${path}`;
            if (storage.has(key) && !options.upsert) {
              return { data: null, error: { statusCode: "409", message: "The resource already exists" } };
            }
            storage.set(key, { body, contentType: options.contentType });
            calls.uploads.push({ bucket, path, options, size: body?.byteLength ?? body?.size });
            return { data: { path }, error: null };
          },
          async download(path) {
            calls.downloads.push(`${bucket}/${path}`);
            const object = storage.get(`${bucket}/${path}`);
            if (!object) return { data: null, error: { statusCode: 404, message: "Object not found" } };
            return { data: new Blob([object.body]), error: null };
          },
          async info(path) {
            const object = storage.get(`${bucket}/${path}`);
            if (!object) return { data: null, error: { statusCode: 404, message: "Object not found" } };
            return { data: { size: object.body?.byteLength ?? 0, contentType: object.contentType }, error: null };
          },
          async createSignedUrl(path, expiresIn, options) {
            calls.signed.push({ bucket, path, expiresIn, options });
            return { data: { signedUrl: `https://signed.example/${bucket}/${path}?ttl=${expiresIn}` }, error: null };
          },
        };
      },
    },
    auth: {
      async getUser(token) {
        const user = users[token];
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid token" } };
      },
    },
    from,
  };
}
