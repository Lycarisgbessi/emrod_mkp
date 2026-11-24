import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import { hashPassword, hashTrackingToken } from './auth';

/**
 * PostgreSQL backend (Neon-compatible). The rest of the codebase keeps the
 * historical SQLite-shaped API — `db.prepare(sql).all/get/run(...)` with `?`
 * placeholders — so the migration touches the driver, not 200 call sites.
 */
const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL manquant. Renseignez l’URL PostgreSQL (ex. Neon) dans l’environnement : ' +
      'postgresql://utilisateur:motdepasse@hote/base?sslmode=require'
  );
}

// int8 (SUM/COUNT bigint) et numeric (AVG) arrivent en texte côté pg :
// on les convertit en nombres JS pour garder le comportement du driver SQLite.
pg.types.setTypeParser(20, (v) => Number(v)); // int8
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 5),
  // Neon et la plupart des hébergeurs exigent TLS ; l'URL `sslmode=require` suffit,
  // sinon on active TLS sans vérification de chaîne (certificats Rotating AWS).
  ssl: /sslmode=/.test(DATABASE_URL) ? undefined : { rejectUnauthorized: false },
});
pool.on('error', (err) => {
  console.error('[db] Erreur du pool PostgreSQL :', err.message);
});

/** Paramètres : booléens → 0/1 (parité SQLite), undefined → null, Date → ISO. */
function marshalParam(v: unknown): unknown {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/**
 * `?` → `$1..$n` (numérotation dans l'ordre d'apparition).
 * Les `?` À L'INTÉRIEUR des littéraux de chaîne SQL (textes français avec
 * « prêt ? »…) ne sont PAS des placeholders — on les laisse intacts.
 */
function toPgSql(sql: string): string {
  let out = '';
  let n = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (inString) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          // apostrophe échappée SQL ('') — on reste dans la chaîne
          out += "'";
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '?') {
      n += 1;
      out += `$${n}`;
      continue;
    }
    out += ch;
  }
  return out;
}

// Transaction courante scopée par chaîne async : seules les requêtes exécutées
// DANS runInTransaction voient la connexion dédiée — les requêtes concurrentes
// d'autres requêtes HTTP continuent sur le pool (impossible à faire avec un
// simple global, qui mélangerait les transactions sous concurrence).
const txStorage = new AsyncLocalStorage<{ client: pg.PoolClient }>();

async function execSql(text: string, values: unknown[]): Promise<pg.QueryResult> {
  const store = txStorage.getStore();
  if (store) return store.client.query(text, values);
  return pool.query(text, values);
}

export interface SqlStatement {
  // Typés `any` volontairement : à l'exécution ce sont des Promises, mais `any`
  // préserve les casts `as T` historiques des sites d'appel (héritage node:sqlite).
  all: (...args: unknown[]) => any;
  get: (...args: unknown[]) => any;
  run: (...args: unknown[]) => Promise<{ changes: number }>;
}

// Prepared-statement cache: la conversion `?`→`$n` et la création de l'objet
// statement sont mises en cache par SQL (comportement identique à l'ancien driver).
const statementCache = new Map<string, SqlStatement>();

export const db = {
  prepare(rawSql: string): SqlStatement {
    let stmt = statementCache.get(rawSql);
    if (!stmt) {
      stmt = {
        all: async (...args: unknown[]) => {
          const res = await execSql(toPgSql(rawSql), args.map(marshalParam));
          return res.rows;
        },
        get: async (...args: unknown[]) => {
          const res = await execSql(toPgSql(rawSql), args.map(marshalParam));
          return res.rows[0];
        },
        run: async (...args: unknown[]) => {
          const res = await execSql(toPgSql(rawSql), args.map(marshalParam));
          return { changes: res.rowCount ?? 0 };
        },
      };
      statementCache.set(rawSql, stmt);
    }
    return stmt;
  },

  async exec(sql: string): Promise<void> {
    // Requêtes multiples (DDL, seeds) : le protocole simple de PostgreSQL
    // accepte les scripts multi-instructions sans paramètres.
    await execSql(sql, []);
  },
};

/**
 * Runs `fn` inside a single PostgreSQL transaction (dedicated connection).
 * Nested calls join the outer transaction instead of failing on BEGIN.
 */
export async function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStorage.getStore()) {
    // Transaction imbriquée : on rejoint la transaction externe (parité SQLite)
    return fn();
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await txStorage.run({ client }, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection already broken — nothing to roll back
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resolves a seed account password: env override first, otherwise a strong random
 * password generated once per fresh database and printed to the console.
 * Never hardcode credentials in source — anyone reading the repo could log in as admin.
 */
const generatedSeedPasswords: Array<{ label: string; password: string }> = [];
function getSeedPassword(envKey: string, label: string): string {
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) return fromEnv;
  const password = crypto.randomBytes(12).toString('base64url');
  generatedSeedPasswords.push({ label, password });
  return password;
}

function printGeneratedSeedPasswords(): void {
  if (generatedSeedPasswords.length === 0) return;
  console.log('─'.repeat(72));
  console.log('Mots de passe des comptes de démonstration générés pour cette base :');
  for (const entry of generatedSeedPasswords) {
    console.log(`  ${entry.label} → ${entry.password}`);
  }
  console.log('Définissez SEED_*_PASSWORD dans l’environnement pour les fixer durablement.');
  console.log('─'.repeat(72));
}

export async function initSchema(): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'vendor')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_review', 'validated', 'rejected', 'suspended')),
      status_reason TEXT DEFAULT '',
      email_verified INTEGER NOT NULL DEFAULT 0,
      phone_verified INTEGER NOT NULL DEFAULT 0,
      entity_type TEXT NOT NULL DEFAULT 'individual' CHECK(entity_type IN ('individual', 'company')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vendor_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE,
      shop_name TEXT NOT NULL,
      description TEXT NOT NULL,
      story TEXT DEFAULT '',
      location TEXT NOT NULL,
      logo_url TEXT DEFAULT '',
      is_emrod_official INTEGER NOT NULL DEFAULT 0,
      default_zones_json TEXT NOT NULL DEFAULT '[]',
      response_time_label TEXT NOT NULL DEFAULT 'Répond sous 2h',
      custom_fields_json TEXT NOT NULL DEFAULT '{}',
      bank_transfer_enabled INTEGER NOT NULL DEFAULT 0,
      bank_name TEXT NOT NULL DEFAULT '',
      bank_account_holder TEXT NOT NULL DEFAULT '',
      bank_iban_rib TEXT NOT NULL DEFAULT '',
      bank_swift_bic TEXT NOT NULL DEFAULT '',
      bank_instructions TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kyc_documents (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      doc_label TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_data_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      reviewer_id TEXT,
      rejection_reason TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS badge_definitions (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      criteria_description TEXT NOT NULL,
      public_description TEXT NOT NULL,
      is_mandatory INTEGER NOT NULL DEFAULT 0,
      auto_assign INTEGER NOT NULL DEFAULT 0,
      auto_criteria_json TEXT NOT NULL DEFAULT '{}',
      effect_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS certifications (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id TEXT NOT NULL REFERENCES badge_definitions(id) ON DELETE CASCADE,
      granted_by TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      revoke_reason TEXT DEFAULT '',
      expires_at TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS platform_rules (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      required_badge_id TEXT REFERENCES badge_definitions(id) ON DELETE SET NULL,
      is_restricted INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      vendor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      materials TEXT NOT NULL,
      dimensions TEXT NOT NULL,
      weight_kg REAL NOT NULL DEFAULT 25,
      price_gnf INTEGER NOT NULL DEFAULT 0,
      compare_at_price_gnf INTEGER,
      mode TEXT NOT NULL DEFAULT 'direct' CHECK(mode IN ('direct', 'sur_devis')),
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'in_review', 'published', 'archived', 'removed')),
      removal_reason TEXT DEFAULT '',
      stock_qty INTEGER NOT NULL DEFAULT 1,
      is_unique_piece INTEGER NOT NULL DEFAULT 0,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      delivery_config_json TEXT NOT NULL DEFAULT '{}',
      featured INTEGER NOT NULL DEFAULT 0,
      views_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_media (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'image' CHECK(type IN ('image', 'video')),
      url TEXT NOT NULL,
      poster_url TEXT,
      alt_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      buyer_name TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      buyer_phone TEXT NOT NULL,
      delivery_zone_id TEXT NOT NULL,
      delivery_zone_name TEXT NOT NULL,
      delivery_address TEXT NOT NULL,
      delivery_landmark TEXT DEFAULT '',
      subtotal_gnf INTEGER NOT NULL,
      delivery_fee_gnf INTEGER NOT NULL,
      total_gnf INTEGER NOT NULL,
      status TEXT NOT NULL,
      tracking_token_hash TEXT NOT NULL UNIQUE,
      tracking_token_expires_at TEXT NOT NULL,
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      payment_mode TEXT NOT NULL DEFAULT 'redirect',
      payment_plan TEXT NOT NULL DEFAULT 'full',
      deposit_percent INTEGER NOT NULL DEFAULT 100,
      amount_paid_now_gnf INTEGER NOT NULL DEFAULT 0,
      balance_due_gnf INTEGER NOT NULL DEFAULT 0,
      bank_transfer_reference TEXT DEFAULT '',
      bank_transfer_declared_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      vendor_id TEXT NOT NULL REFERENCES users(id),
      product_name TEXT NOT NULL,
      product_slug TEXT NOT NULL,
      product_image TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_gnf INTEGER NOT NULL,
      delivery_fee_gnf INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      comment TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      quote_id TEXT,
      djomy_reference TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('payment', 'payment_link', 'refund')),
      method TEXT NOT NULL,
      operator TEXT DEFAULT '',
      amount_gnf INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'authorized', 'succeeded', 'failed', 'refunded')),
      payment_url TEXT,
      otp_required INTEGER NOT NULL DEFAULT 0,
      raw_webhook_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL REFERENCES users(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      amount_gnf INTEGER NOT NULL,
      reference TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'scheduled', 'paid')),
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS quote_requests (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      vendor_id TEXT NOT NULL REFERENCES users(id),
      buyer_name TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      buyer_phone TEXT NOT NULL,
      preferred_material TEXT NOT NULL,
      dimensions_notes TEXT NOT NULL,
      project_notes TEXT NOT NULL,
      step_status TEXT NOT NULL DEFAULT 'material',
      quoted_amount_gnf INTEGER,
      payment_link_url TEXT,
      djomy_reference TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      desired_zone_id TEXT DEFAULT 'ratoma-sonfonia',
      tracking_token_hash TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      vendor_id TEXT NOT NULL REFERENCES users(id),
      buyer_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment TEXT NOT NULL,
      photos_json TEXT NOT NULL DEFAULT '[]',
      vendor_reply TEXT DEFAULT '',
      vendor_replied_at TEXT,
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'hidden')),
      moderation_reason TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('order', 'product', 'quote')),
      order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
      quote_id TEXT REFERENCES quote_requests(id) ON DELETE CASCADE,
      vendor_id TEXT NOT NULL REFERENCES users(id),
      buyer_name TEXT NOT NULL,
      buyer_email TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_role TEXT NOT NULL CHECK(sender_role IN ('buyer', 'vendor', 'admin')),
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      is_flagged INTEGER NOT NULL DEFAULT 0,
      flag_reason TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible', 'hidden')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      opened_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved_refund', 'resolved_release', 'closed')),
      resolution_notes TEXT DEFAULT '',
      messages_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      keys_json TEXT NOT NULL DEFAULT '{}',
      categories_json TEXT NOT NULL DEFAULT '[]',
      region TEXT NOT NULL DEFAULT 'Conakry',
      frequency TEXT NOT NULL DEFAULT 'instant' CHECK(frequency IN ('instant', 'weekly_digest', 'disabled')),
      email_fallback TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      target_category TEXT NOT NULL DEFAULT 'all',
      target_region TEXT NOT NULL DEFAULT 'all',
      target_url TEXT NOT NULL DEFAULT '/catalogue',
      sent_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      opened_count INTEGER NOT NULL DEFAULT 0,
      unsubscribed_count INTEGER NOT NULL DEFAULT 0,
      scheduled_for TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      before_json TEXT DEFAULT '{}',
      after_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS data_privacy_requests (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      request_type TEXT NOT NULL CHECK(request_type IN ('access', 'deletion')),
      status TEXT NOT NULL DEFAULT 'received',
      created_at TEXT NOT NULL
    );
  `);

  await runMigrations();
}

async function ensureColumn(table: string, column: string, definition: string): Promise<void> {
  const res = await execSql(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  if ((res.rowCount ?? 0) === 0) {
    await execSql(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, []);
  }
}

async function runMigrations(): Promise<void> {
  await ensureColumn('vendor_profiles', 'bank_transfer_enabled', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('vendor_profiles', 'bank_name', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('vendor_profiles', 'bank_account_holder', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('vendor_profiles', 'bank_iban_rib', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('vendor_profiles', 'bank_swift_bic', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('vendor_profiles', 'bank_instructions', "TEXT NOT NULL DEFAULT ''");

  await ensureColumn('orders', 'payment_plan', "TEXT NOT NULL DEFAULT 'full'");
  await ensureColumn('orders', 'deposit_percent', 'INTEGER NOT NULL DEFAULT 100');
  await ensureColumn('orders', 'amount_paid_now_gnf', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('orders', 'balance_due_gnf', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('orders', 'bank_transfer_reference', "TEXT DEFAULT ''");
  await ensureColumn('orders', 'bank_transfer_declared_at', 'TEXT');

  await ensureColumn('quote_requests', 'quantity', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('quote_requests', 'desired_zone_id', "TEXT DEFAULT 'ratoma-sonfonia'");
  await ensureColumn('quote_requests', 'tracking_token_hash', "TEXT DEFAULT ''");

  await ensureColumn('payments', 'merchant_payment_reference', "TEXT DEFAULT ''");
  await ensureColumn('payments', 'provider_reference', "TEXT DEFAULT ''");
  await ensureColumn('payments', 'fees_gnf', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('payments', 'received_amount_gnf', 'INTEGER NOT NULL DEFAULT 0');

  // Secondary indexes for the hot read paths (catalog, dashboards, order tracking).
  // Without them every JOIN/GROUP BY on these foreign keys degenerates into full scans.
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_product_media_product ON product_media(product_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_vendor ON order_items(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_quote ON payments(quote_id);
    CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(djomy_reference);
    CREATE INDEX IF NOT EXISTS idx_reviews_vendor ON reviews(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_order ON reviews(order_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_kyc_documents_vendor ON kyc_documents(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_quote ON conversations(quote_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_order ON conversations(order_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_order_vendor ON payouts(order_id, vendor_id);
    CREATE INDEX IF NOT EXISTS idx_certifications_vendor ON certifications(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
  `);

  // ═══════════════════════════════════════════════════════════════════
  // v2 ADMIN PLATFORM: commissions, analytics, security, e-mail log…
  // ═══════════════════════════════════════════════════════════════════
  await db.exec(`
    -- Platform commission ledger (brut → commission → net per transaction)
    CREATE TABLE IF NOT EXISTS commissions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
      vendor_id TEXT NOT NULL REFERENCES users(id),
      gross_gnf INTEGER NOT NULL,
      rate_percent REAL NOT NULL,
      commission_gnf INTEGER NOT NULL,
      net_vendor_gnf INTEGER NOT NULL,
      base TEXT NOT NULL DEFAULT 'subtotal',
      status TEXT NOT NULL DEFAULT 'earned' CHECK(status IN ('due','earned','reversed')),
      source TEXT NOT NULL DEFAULT 'webhook',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Funnel & traffic analytics (product_view / cart_add / checkout_start / payment_success)
    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('product_view','cart_add','checkout_start','payment_success')),
      product_id TEXT,
      order_id TEXT,
      meta TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- Search terms (incl. zero-result searches → catalogue opportunities)
    CREATE TABLE IF NOT EXISTS search_queries (
      id TEXT PRIMARY KEY,
      q TEXT NOT NULL,
      results_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- JWT issuance registry + revocations (admin can force-logout any session)
    CREATE TABLE IF NOT EXISTS issued_tokens (
      jti TEXT PRIMARY KEY,
      sub TEXT NOT NULL,
      role TEXT NOT NULL,
      email TEXT DEFAULT '',
      exp TEXT NOT NULL, -- ISO 8601 : la comparaison lexicographique reste chronologique
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS token_revocations (
      jti TEXT PRIMARY KEY,
      revoked_at TEXT NOT NULL
    );

    -- Login attempts (failed login monitoring)
    CREATE TABLE IF NOT EXISTS login_attempts (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      ip TEXT DEFAULT '',
      success INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- Transactional e-mail journal
    CREATE TABLE IF NOT EXISTS email_log (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- Buyer blacklist (abusive guests, by email OR phone)
    CREATE TABLE IF NOT EXISTS buyer_blacklist (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'email' CHECK(kind IN ('email','phone')),
      reason TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_commissions_order ON commissions(order_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_vendor ON commissions(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_commissions_created ON commissions(created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_type_created ON analytics_events(type, created_at);
    CREATE INDEX IF NOT EXISTS idx_search_q ON search_queries(q);
    CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at);
    CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at);
  `);

  await ensureColumn('payouts', 'commission_gnf', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('payouts', 'net_amount_gnf', 'INTEGER NOT NULL DEFAULT 0');

  // Default commission configuration + maintenance flag (idempotent, existing rules kept)
  await db.exec(`
    INSERT INTO platform_rules (key, value_json, updated_at) VALUES (
      'commission_config',
      '{"enabled":true,"defaultPercent":10,"vendorOverrides":{},"categoryOverrides":{},"base":"subtotal","minCommissionGnf":0,"applyToQuotes":true}',
      '1970-01-01T00:00:00.000Z'
    ) ON CONFLICT (key) DO NOTHING;
    INSERT INTO platform_rules (key, value_json, updated_at) VALUES (
      'maintenance',
      '{"enabled":false,"message":"Maintenance en cours — les commandes reprennent dans quelques minutes."}',
      '1970-01-01T00:00:00.000Z'
    ) ON CONFLICT (key) DO NOTHING;
  `);

  // Migrate legacy '/src/assets/images/' URLs to stable public assets
  // (dev-only paths that would 404 in a production build)
  await db.exec(`
    UPDATE product_media SET url = REPLACE(url, '/src/assets/images/', '/assets/seed/')
     WHERE url LIKE '/src/assets/images/%';
    UPDATE vendor_profiles SET logo_url = REPLACE(logo_url, '/src/assets/images/', '/assets/seed/')
     WHERE logo_url LIKE '/src/assets/images/%';
    UPDATE kyc_documents SET file_data_url = REPLACE(file_data_url, '/src/assets/images/', '/assets/seed/')
     WHERE file_data_url LIKE '/src/assets/images/%';
    UPDATE order_items SET product_image = REPLACE(product_image, '/src/assets/images/', '/assets/seed/')
     WHERE product_image LIKE '/src/assets/images/%';
    UPDATE products SET keywords_json = REPLACE(keywords_json, '/src/assets/images/', '/assets/seed/')
     WHERE keywords_json LIKE '%/src/assets/images/%';
    UPDATE platform_rules SET value_json = REPLACE(value_json, '/src/assets/images/', '/assets/seed/')
     WHERE value_json LIKE '%/src/assets/images/%';
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      djomy_reference TEXT DEFAULT '',
      raw_json TEXT NOT NULL,
      processed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  // Upgrade the seed legal texts to their complete version — only when the stored
  // text is still the untouched v1 seed (admin customizations are never overwritten).
  const legalRow = await db
    .prepare(`SELECT value_json FROM platform_rules WHERE key = 'institutional_texts'`)
    .get() as { value_json: string } | undefined;
  if (legalRow && legalRow.value_json.includes('parcours en 4 étapes (Matériau, Design, Façonnage, Livraison)')) {
    try {
      const legal = JSON.parse(legalRow.value_json) as Record<string, string>;
      legal.mentions =
        'EMROD SARL — Maison de mobilier sur mesure et artisanat d’exception.\nSiège & Atelier : T7, Corniche Nord, Virage du lac Sonfonia Centre (Carrefour Canal Plus), Conakry, République de Guinée.\nTéléphones : +224 623 88 59 59 / +224 621 08 41 46 · Courriels : contact@emroddf.com / direction@emroddf.com.\nHoraires d’ouverture : du lundi au samedi, de 8 h à 18 h.\n\nÉditeur : EMROD SARL, société immatriculée au RCCM de Conakry. Directeur de la publication : la Direction EMROD SARL.\nHébergement : serveurs de la plateforme EMROD (coordonnées communiquées sur demande motivée).\nPropriété intellectuelle : l’ensemble des créations, visuels et descriptifs présentés sur la marketplace demeure la propriété de EMROD SARL et de ses ateliers partenaires ; toute reproduction sans autorisation écrite est interdite.\nMédiation : en cas de différend, l’acheteur peut ouvrir un litige directement depuis sa page de suivi ; à défaut d’accord amiable sous 14 jours, le litige est arbitré par la Direction EMROD SARL conformément aux CGV.';
      legal.cgv =
        '1. Objet — Les présentes conditions générales régissent les ventes de mobilier et de créations artisanales conclues sur EMROD Marketplace entre les ateliers partenaires et des acheteurs consommateurs.\n2. Commandes sans compte — Toute commande validée génère un lien de suivi personnel sécurisé valable 12 mois ; ce lien constitue la preuve d’achat et le canal exclusif de suivi, de messagerie et de litige.\n3. Prix — Les prix sont affichés en francs guinéens (GNF), toutes taxes comprises, hors frais de livraison calculés selon la zone et le poids. Le paiement s’effectue exclusivement via le portail certifié Djomy (Orange Money, MTN MoMo, Kulu, Soutra Money, PayCard, cartes bancaires, liens de paiement).\n4. Acompte et solde — Pour les commandes le permettant, un acompte (par défaut 30 %) peut être réglé en ligne, le solde étant encaissé à la livraison. Les commandes d’un montant élevé peuvent être réglées par virement bancaire selon les conditions affichées au checkout.\n5. Fabrication sur mesure — Les créations sur devis suivent un parcours en 4 étapes (Choix du matériau, Validation du design, Façonnage & finitions, Livraison & montage). Le devis validé et réglé vaut contrat de fabrication ; les dimensions et essences validées ne peuvent plus être modifiées après lancement de la fabrication.\n6. Annulation — L’acheteur peut annuler sans frais tant que la commande n’a pas atteint le statut « Expédiée » ; les paiements effectués sont remboursés sur le même moyen de paiement via Djomy. Après expédition, seule la procédure de litige est ouverte.\n7. Livraison — Livraison et montage assurés dans les zones desservies (Conakry et intérieur du pays selon tarifs affichés) aux délais estimés indiqués par zone. Les retards imputables au transport n’engagent pas la responsabilité de l’atelier dès lors que l’acheteur en est informé via le suivi.\n8. Garantie — Les créations bénéficient de la garantie légale de conformité. Les pièces uniques en bois massif et cuir naturel peuvent présenter de légères variations de teinte et de veinage inhérentes aux matériaux naturels, qui ne constituent pas des défauts de conformité.\n9. Litiges — En cas de dommage, de non-conformité ou de retard anormal, l’acheteur ouvre un litige depuis son lien de suivi ; EMROD arbitre sous 14 jours et peut déclencher le remboursement via Djomy.\n10. Droit applicable — Les présentes CGV sont soumises au droit guinéen ; à défaut de résolution amiable, les tribunaux de Conakry sont compétents.';
      legal.confidentialite =
        'EMROD SARL, en qualité de responsable de traitement, collecte uniquement les coordonnées strictement nécessaires au traitement et au suivi des commandes : nom, numéro de téléphone, courriel, adresse de livraison et historique de suivi.\nFinalités : traitement des commandes, livraison, service après-vente, alertes d’information (sur consentement explicite) et obligations légales/comptables.\nAucune donnée bancaire n’est conservée sur nos serveurs : les paiements sont traités exclusivement par la passerelle certifiée Djomy.\nDurée de conservation : les données de suivi sont conservées pendant la durée de validité du jeton (12 mois), puis anonymisées ; les données comptables sont conservées selon les durées légales en vigueur.\nVos droits : accès, rectification et suppression s’exercent depuis la page « Alertes & Confidentialité » (demande d’accès ou de suppression) ou par courriel à contact@emroddf.com. Les demandes sont traitées sous 30 jours.\nSous-traitants : passerelle de paiement Djomy, hébergeur de la plateforme. Aucun transfert de données à des tiers à des fins commerciales n’est effectué.\nVous pouvez introduire une réclamation auprès de l’autorité de protection des données guinéenne compétente.';
      await db.prepare(`UPDATE platform_rules SET value_json = ?, updated_at = ? WHERE key = 'institutional_texts'`).run(
        JSON.stringify(legal),
        new Date().toISOString()
      );
    } catch {
      // ignore malformed legacy JSON
    }
  }
}

export function logAudit(params: {
  actorId: string;
  actorRole: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}): void {
  // Fire-and-forget: l'audit ne doit jamais bloquer ni faire échouer une mutation.
  void db
    .prepare(
      `INSERT INTO audit_logs (id, actor_id, actor_role, actor_name, action, target_type, target_id, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      params.actorId,
      params.actorRole,
      params.actorName,
      params.action,
      params.targetType,
      params.targetId,
      JSON.stringify(params.before ?? {}),
      JSON.stringify(params.after ?? {}),
      new Date().toISOString()
    )
    .catch((err: unknown) => {
      console.error('[db] Écriture audit_logs échouée :', err instanceof Error ? err.message : err);
    });
}

export async function seedDatabase(): Promise<void> {
  const existingRule = await db.prepare(`SELECT key FROM platform_rules WHERE key = 'delivery_zones'`).get();
  if (existingRule) return;

  const now = new Date().toISOString();

  // 1. Platform Rules (F-ADM-03, F-ADM-05, F-ADM-08, F-ADM-12, F-CAT-01)
  const rules: Array<[string, unknown]> = [
    [
      'registration_requirements',
      {
        fields: [
          { key: 'shopName', label: 'Nom de l’atelier ou boutique', type: 'text', required: true },
          { key: 'location', label: 'Quartier / Ville', type: 'text', required: true },
          { key: 'description', label: 'Présentation de votre savoir-faire', type: 'textarea', required: true },
          {
            key: 'specialty',
            label: 'Matière de prédilection',
            type: 'select',
            required: true,
            options: ['Bois nobles (Chêne / Noyer / Iroko)', 'Cuirs pleine fleur', 'Métaux texturés', 'Vannerie & Fibres'],
          },
        ],
        documents: [
          {
            type: 'id_card',
            label: 'Pièce d’identité nationale ou Passeport',
            description: 'Document officiel lisible (photo ou PDF).',
            required: true,
            appliesTo: 'all',
          },
          {
            type: 'rccm',
            label: 'Registre de Commerce (RCCM)',
            description: 'Obligatoire pour les ateliers constitués en société (SARL, SUARL).',
            required: true,
            appliesTo: 'company',
          },
          {
            type: 'atelier_photo',
            label: 'Photographie de l’atelier et d’une réalisation finie',
            description: 'Permet à EMROD d’apprécier la qualité des finitions à la main.',
            required: false,
            appliesTo: 'all',
          },
        ],
      },
    ],
    [
      'commercial_restrictions',
      {
        vendorRegistrationEnabled: true,
        preModerationEnabled: false,
        maxProductsUncertified: 3,
        allowExternalContactsInMessages: false,
        trackingTokenValidityMonths: 12,
        payoutsEnabled: true,
        defaultDepositPercent: 30,
        bankTransferMinGnf: 15000000,
      },
    ],
    [
      'delivery_zones',
      [
        {
          id: 'kaloum',
          name: 'Kaloum & Centre-ville',
          region: 'Conakry',
          landmarks: 'Almamya, Boulbinet, Sandervalia, Tombo',
          pricingMode: 'fixed',
          fixedFeeGnf: 150000,
          weightTiers: [],
          estimatedDays: '24 à 48h',
          active: true,
        },
        {
          id: 'dixinn-matam',
          name: 'Dixinn & Matam',
          region: 'Conakry',
          landmarks: 'Camayenne, Belle-Vue, Landréah, Madina, Coleah',
          pricingMode: 'fixed',
          fixedFeeGnf: 120000,
          weightTiers: [],
          estimatedDays: '24 à 48h',
          active: true,
        },
        {
          id: 'ratoma-sonfonia',
          name: 'Ratoma, Kipé & Sonfonia',
          region: 'Conakry',
          landmarks: 'Corniche Nord, Virage du lac Sonfonia, Kipé, Lambanyi, Kobaya',
          pricingMode: 'weight_tier',
          fixedFeeGnf: 100000,
          weightTiers: [
            { maxKg: 25, feeGnf: 90000 },
            { maxKg: 75, feeGnf: 150000 },
            { maxKg: 250, feeGnf: 250000 },
          ],
          estimatedDays: '24 à 48h',
          active: true,
        },
        {
          id: 'matoto-coyah',
          name: 'Matoto, Enta & Coyah',
          region: 'Grand Conakry',
          landmarks: 'Gbessia, Sangoyah, Tanéné, Coyah Centre',
          pricingMode: 'weight_tier',
          fixedFeeGnf: 200000,
          weightTiers: [
            { maxKg: 25, feeGnf: 160000 },
            { maxKg: 75, feeGnf: 240000 },
            { maxKg: 250, feeGnf: 380000 },
          ],
          estimatedDays: '48 à 72h',
          active: true,
        },
        {
          id: 'interieur',
          name: 'Intérieur du pays (Kindia, Labé, Kankan)',
          region: 'Guinée',
          landmarks: 'Expédition sécurisée avec emballage bois renforcé',
          pricingMode: 'weight_tier',
          fixedFeeGnf: 450000,
          weightTiers: [
            { maxKg: 25, feeGnf: 350000 },
            { maxKg: 75, feeGnf: 550000 },
            { maxKg: 250, feeGnf: 850000 },
          ],
          estimatedDays: '4 à 7 jours',
          active: true,
        },
      ],
    ],
    [
      'editorial_homepage',
      {
        announcementText: 'Livraison et montage assurés à Conakry · Paiement sécurisé Djomy (Orange Money, MTN, Carte)',
        heroTitle: 'Des meubles uniques, sur mesure, créés par des femmes pour votre intérieur.',
        heroSubtitle:
          'Bois nobles de Guinée, cuirs pleine fleur et métaux texturés façonnés à la main dans notre atelier de Sonfonia et chez nos artisans certifiés.',
        heroCtaLabel: 'Explorer la collection',
        featuredTitle: 'Pièces signatures & éditions d’atelier',
        featuredSubtitle:
          'Chaque création allie justesse architecturale, durabilité absolue et finitions appliquées à la main.',
      },
    ],
    [
      'institutional_texts',
      {
        mentions:
          'EMROD SARL — Maison de mobilier sur mesure et artisanat d’exception.\nSiège & Atelier : T7, Corniche Nord, Virage du lac Sonfonia Centre (Carrefour Canal Plus), Conakry, République de Guinée.\nTéléphones : +224 623 88 59 59 / +224 621 08 41 46 · Courriels : contact@emroddf.com / direction@emroddf.com.\nHoraires d’ouverture : du lundi au samedi, de 8 h à 18 h.\n\nÉditeur : EMROD SARL, société immatriculée au RCCM de Conakry. Directeur de la publication : la Direction EMROD SARL.\nHébergement : serveurs de la plateforme EMROD (coordonnées communiquées sur demande motivée).\nPropriété intellectuelle : l’ensemble des créations, visuels et descriptifs présentés sur la marketplace demeure la propriété de EMROD SARL et de ses ateliers partenaires ; toute reproduction sans autorisation écrite est interdite.\nMédiation : en cas de différend, l’acheteur peut ouvrir un litige directement depuis sa page de suivi ; à défaut d’accord amiable sous 14 jours, le litige est arbitré par la Direction EMROD SARL conformément aux CGV.',
        cgv:
          '1. Objet — Les présentes conditions générales régissent les ventes de mobilier et de créations artisanales conclues sur EMROD Marketplace entre les ateliers partenaires et des acheteurs consommateurs.\n2. Commandes sans compte — Toute commande validée génère un lien de suivi personnel sécurisé valable 12 mois ; ce lien constitue la preuve d’achat et le canal exclusif de suivi, de messagerie et de litige.\n3. Prix — Les prix sont affichés en francs guinéens (GNF), toutes taxes comprises, hors frais de livraison calculés selon la zone et le poids. Le paiement s’effectue exclusivement via le portail certifié Djomy (Orange Money, MTN MoMo, Kulu, Soutra Money, PayCard, cartes bancaires, liens de paiement).\n4. Acompte et solde — Pour les commandes le permettant, un acompte (par défaut 30 %) peut être réglé en ligne, le solde étant encaissé à la livraison. Les commandes d’un montant élevé peuvent être réglées par virement bancaire selon les conditions affichées au checkout.\n5. Fabrication sur mesure — Les créations sur devis suivent un parcours en 4 étapes (Choix du matériau, Validation du design, Façonnage & finitions, Livraison & montage). Le devis validé et réglé vaut contrat de fabrication ; les dimensions et essences validées ne peuvent plus être modifiées après lancement de la fabrication.\n6. Annulation — L’acheteur peut annuler sans frais tant que la commande n’a pas atteint le statut « Expédiée » ; les paiements effectués sont remboursés sur le même moyen de paiement via Djomy. Après expédition, seule la procédure de litige est ouverte.\n7. Livraison — Livraison et montage assurés dans les zones desservies (Conakry et intérieur du pays selon tarifs affichés) aux délais estimés indiqués par zone. Les retards imputables au transport n’engagent pas la responsabilité de l’atelier dès lors que l’acheteur en est informé via le suivi.\n8. Garantie — Les créations bénéficient de la garantie légale de conformité. Les pièces uniques en bois massif et cuir naturel peuvent présenter de légères variations de teinte et de veinage inhérentes aux matériaux naturels, qui ne constituent pas des défauts de conformité.\n9. Litiges — En cas de dommage, de non-conformité ou de retard anormal, l’acheteur ouvre un litige depuis son lien de suivi ; EMROD arbitre sous 14 jours et peut déclencher le remboursement via Djomy.\n10. Droit applicable — Les présentes CGV sont soumises au droit guinéen ; à défaut de résolution amiable, les tribunaux de Conakry sont compétents.',
        confidentialite:
          'EMROD SARL, en qualité de responsable de traitement, collecte uniquement les coordonnées strictement nécessaires au traitement et au suivi des commandes : nom, numéro de téléphone, courriel, adresse de livraison et historique de suivi.\nFinalités : traitement des commandes, livraison, service après-vente, alertes d’information (sur consentement explicite) et obligations légales/comptables.\nAucune donnée bancaire n’est conservée sur nos serveurs : les paiements sont traités exclusivement par la passerelle certifiée Djomy.\nDurée de conservation : les données de suivi sont conservées pendant la durée de validité du jeton (12 mois), puis anonymisées ; les données comptables sont conservées selon les durées légales en vigueur.\nVos droits : accès, rectification et suppression s’exercent depuis la page « Alertes & Confidentialité » (demande d’accès ou de suppression) ou par courriel à contact@emroddf.com. Les demandes sont traitées sous 30 jours.\nSous-traitants : passerelle de paiement Djomy, hébergeur de la plateforme. Aucun transfert de données à des tiers à des fins commerciales n’est effectué.\nVous pouvez introduire une réclamation auprès de l’autorité de protection des données guinéenne compétente.',
      },
    ],
    [
      'admin_auth',
      {
        claimed: false,
        passwordHash: '',
      },
    ],
  ];

  const insertRule = db.prepare(
    `INSERT INTO platform_rules (key, value_json, updated_at) VALUES (?, ?, ?)`
  );
  for (const [k, v] of rules) {
    await insertRule.run(k, JSON.stringify(v), now);
  }

  // 2. Certification Badges (F-CER-02)
  const badges = [
    {
      id: 'badge-atelier-verifie',
      slug: 'atelier-verifie',
      name: 'Atelier vérifié',
      icon: 'shield-check',
      criteriaDescription: 'Identité, registre de commerce et contrôle qualité des finitions validés par EMROD.',
      publicDescription: 'Atelier contrôlé physiquement et documentairement par l’équipe EMROD à Conakry.',
      isMandatory: 0,
      autoAssign: 0,
      autoCriteria: { minApprovedDocs: 2, minPublishedProducts: 0, minAverageRating: 0 },
      effect: { showOnProductCard: true, searchPriorityBoost: 20, unlocksRestrictedCategories: true },
    },
    {
      id: 'badge-vendeur-certifie',
      slug: 'vendeur-certifie',
      name: 'Vendeur certifié',
      icon: 'award',
      criteriaDescription: 'Au moins 1 document d’identité approuvé et note moyenne ≥ 4,2/5.',
      publicDescription: 'Artisan engagé sur la ponctualité des livraisons et l’authenticité des essences de bois.',
      isMandatory: 0,
      autoAssign: 1,
      autoCriteria: { minApprovedDocs: 1, minPublishedProducts: 1, minAverageRating: 4.0 },
      effect: { showOnProductCard: true, searchPriorityBoost: 10, unlocksRestrictedCategories: false },
    },
    {
      id: 'badge-savoir-faire-feminin',
      slug: 'savoir-faire-feminin',
      name: 'Créé par des femmes',
      icon: 'sparkles',
      criteriaDescription: 'Production dirigée et façonnée par des femmes artisanes guinéennes.',
      publicDescription: 'Pièce façonnée par une équipe d’artisanes qualifiées en République de Guinée.',
      isMandatory: 0,
      autoAssign: 0,
      autoCriteria: { minApprovedDocs: 1, minPublishedProducts: 0, minAverageRating: 0 },
      effect: { showOnProductCard: true, searchPriorityBoost: 15, unlocksRestrictedCategories: false },
    },
  ];

  const insertBadge = db.prepare(
    `INSERT INTO badge_definitions (id, slug, name, icon, criteria_description, public_description, is_mandatory, auto_assign, auto_criteria_json, effect_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const b of badges) {
    await insertBadge.run(
      b.id,
      b.slug,
      b.name,
      b.icon,
      b.criteriaDescription,
      b.publicDescription,
      b.isMandatory,
      b.autoAssign,
      JSON.stringify(b.autoCriteria),
      JSON.stringify(b.effect),
      now
    );
  }

  // 3. Categories (including restricted category example from §5.7)
  const categories = [
    {
      id: 'cat-bibliotheques',
      slug: 'bibliotheques',
      name: 'Bibliothèques',
      description: 'Bibliothèques architecturales en bois nobles et structures métalliques.',
      requiredBadgeId: null,
      isRestricted: 0,
      sortOrder: 1,
    },
    {
      id: 'cat-tables-consoles',
      slug: 'tables-consoles',
      name: 'Tables & Consoles',
      description: 'Tables basses sculpturales, consoles d’entrée gainées de cuir pleine fleur.',
      requiredBadgeId: null,
      isRestricted: 0,
      sortOrder: 2,
    },
    {
      id: 'cat-assises',
      slug: 'assises',
      name: 'Assises',
      description: 'Fauteuils de salon et assises ergonomiques en chêne et cuir sellier.',
      requiredBadgeId: null,
      isRestricted: 0,
      sortOrder: 3,
    },
    {
      id: 'cat-rangements',
      slug: 'rangements',
      name: 'Rangements & Buffets',
      description: 'Buffets cannelés, enfilades et pièces de rangement sur mesure.',
      requiredBadgeId: null,
      isRestricted: 0,
      sortOrder: 4,
    },
    {
      id: 'cat-prestige',
      slug: 'mobilier-de-prestige',
      name: 'Mobilier de prestige',
      description: 'Pièces d’exception réservées aux ateliers titulaires du badge « Atelier vérifié ».',
      requiredBadgeId: 'badge-atelier-verifie',
      isRestricted: 1,
      sortOrder: 5,
    },
    {
      id: 'cat-sur-mesure',
      slug: 'pieces-sur-mesure',
      name: 'Pièces sur mesure',
      description: 'Projets sur devis en 4 étapes : matériau, design, façonnage, livraison.',
      requiredBadgeId: null,
      isRestricted: 0,
      sortOrder: 6,
    },
  ];

  const insertCat = db.prepare(
    `INSERT INTO categories (id, slug, name, description, required_badge_id, is_restricted, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of categories) {
    await insertCat.run(c.id, c.slug, c.name, c.description, c.requiredBadgeId, c.isRestricted, c.sortOrder);
  }

  // 4. Founding EMROD SARL Account (Double-hat official vendor) + 1 Pending 3P Vendor Application for Admin KYC queue
  const emrodAdminPassword = getSeedPassword('SEED_EMROD_ADMIN_PASSWORD', 'Admin EMROD (contact@emroddf.com)');
  const emrodUserId = 'usr_emrod_official';
  await db.prepare(
    `INSERT INTO users (id, email, phone, password_hash, role, status, status_reason, email_verified, phone_verified, entity_type, created_at)
     VALUES (?, ?, ?, ?, 'admin', 'validated', 'Maison fondatrice EMROD SARL', 1, 1, 'company', ?)`
  ).run(emrodUserId, 'contact@emroddf.com', '+224 623 88 59 59', hashPassword(emrodAdminPassword), now);

  await db.prepare(
    `INSERT INTO vendor_profiles (user_id, slug, shop_name, description, story, location, logo_url, is_emrod_official, default_zones_json, response_time_label, custom_fields_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(
    emrodUserId,
    'emrod-sarl',
    'EMROD SARL — Atelier Conakry',
    'Création de mobilier sur mesure et artisanat d’exception : bibliothèques, pièces de rangement et mobilier d’intérieur en bois nobles de Guinée, cuirs pleine fleur et métaux texturés.',
    'Installé sur la Corniche Nord au virage du lac Sonfonia Centre, l’atelier EMROD réunit une équipe de femmes artisanes d’élite. Chaque pièce traverse quatre étapes exigeantes : choix éthique du matériau avec le client, validation du design sur plans détaillés, façonnage et finitions appliquées à la main, puis livraison et montage à Conakry.',
    'T7, Corniche Nord, Sonfonia Centre, Conakry',
    '/assets/seed/atelier_femmes_artisanes_1795278979185.jpg',
    JSON.stringify(['kaloum', 'dixinn-matam', 'ratoma-sonfonia', 'matoto-coyah', 'interieur']),
    'Répond sous 2 heures',
    JSON.stringify({ specialty: 'Bois nobles (Chêne / Noyer / Iroko)' }),
    now
  );

  // Grant all 3 certifications to EMROD SARL
  const insertCert = db.prepare(
    `INSERT INTO certifications (id, vendor_id, badge_id, granted_by, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`
  );
  await insertCert.run('cert_emrod_1', emrodUserId, 'badge-atelier-verifie', emrodUserId, now);
  await insertCert.run('cert_emrod_2', emrodUserId, 'badge-vendeur-certifie', emrodUserId, now);
  await insertCert.run('cert_emrod_3', emrodUserId, 'badge-savoir-faire-feminin', emrodUserId, now);

  // Seed EMROD KYC documents as approved
  await db.prepare(
    `INSERT INTO kyc_documents (id, vendor_id, doc_type, doc_label, file_name, file_data_url, status, reviewer_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)`
  ).run(
    'doc_emrod_rccm',
    emrodUserId,
    'rccm',
    'Registre de Commerce (RCCM)',
    'RCCM-EMROD-SARL-CONAKRY.pdf',
    '/assets/seed/atelier_femmes_artisanes_1795278979185.jpg',
    emrodUserId,
    now,
    now
  );

  // Pending 3P Vendor Application (visible in Admin KYC queue, not yet active on storefront per §4.1!)
  const nimbaPassword = getSeedPassword('SEED_VENDOR_NIMBA_PASSWORD', 'Vendeur Atelier Nimba (atelier@nimba-bois.gn)');
  const nimbaUserId = 'usr_atelier_nimba';
  await db.prepare(
    `INSERT INTO users (id, email, phone, password_hash, role, status, status_reason, email_verified, phone_verified, entity_type, created_at)
     VALUES (?, ?, ?, ?, 'vendor', 'in_review', 'Dossier complet déposé, en attente de validation EMROD', 1, 1, 'company', ?)`
  ).run(nimbaUserId, 'atelier@nimba-bois.gn', '+224 621 44 19 80', hashPassword(nimbaPassword), now);

  await db.prepare(
    `INSERT INTO vendor_profiles (user_id, slug, shop_name, description, story, location, logo_url, is_emrod_official, default_zones_json, response_time_label, custom_fields_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
  ).run(
    nimbaUserId,
    'atelier-nimba',
    'Atelier Nimba Ébénisterie',
    'Menuiserie d’art et mobilier contemporain en bois de teck et iroko du Fouta.',
    'Fondé en 2022 à Ratoma, Atelier Nimba souhaite rejoindre la place de marché EMROD pour proposer ses assises et consoles.',
    'Kipé, Commune de Ratoma, Conakry',
    '/assets/seed/product_fauteuil_cuir_bois_1795278979269.jpg',
    JSON.stringify(['kaloum', 'dixinn-matam', 'ratoma-sonfonia']),
    'Répond sous 4 heures',
    JSON.stringify({ specialty: 'Bois nobles (Chêne / Noyer / Iroko)' }),
    now
  );

  await db.prepare(
    `INSERT INTO kyc_documents (id, vendor_id, doc_type, doc_label, file_name, file_data_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    'doc_nimba_id',
    nimbaUserId,
    'id_card',
    'Pièce d’identité nationale ou Passeport',
    'CNI-Gerant-Nimba.jpg',
    '/assets/seed/atelier_femmes_artisanes_1795278979185.jpg',
    now,
    now
  );
  await db.prepare(
    `INSERT INTO kyc_documents (id, vendor_id, doc_type, doc_label, file_name, file_data_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    'doc_nimba_rccm',
    nimbaUserId,
    'rccm',
    'Registre de Commerce (RCCM)',
    'RCCM-Atelier-Nimba.pdf',
    '/assets/seed/product_bibliotheque_noyer_1795278978216.jpg',
    now,
    now
  );

  // 5. Seed EMROD Official Products (using our 7 generated luxury furniture photographs)
  const products = [
    {
      id: 'prd_biblio_corniche',
      slug: 'bibliotheque-corniche-noyer-acier',
      categoryId: 'cat-bibliotheques',
      name: 'Bibliothèque Corniche en Noyer & Acier Forgé',
      description:
        'Façonnée à la main par nos artisanes à Sonfonia, la bibliothèque Corniche associe des plateaux en noyer massif de Guinée huilés à la cire naturelle à des montants en acier forgé noir et équerres en laiton brossé. Pensée pour structurer un salon ou un bureau de direction avec sobriété et durabilité.',
      materials: 'Noyer massif de Guinée, acier forgé texturé, laiton brossé',
      dimensions: 'L 210 × P 38 × H 225 cm',
      weightKg: 82,
      priceGnf: 14500000,
      compareAtPriceGnf: 16200000,
      mode: 'direct',
      stockQty: 3,
      isUniquePiece: 0,
      keywords: ['bibliotheque', 'noyer', 'acier', 'laiton', 'fait main', 'conakry', 'salon'],
      featured: 1,
      media: [
        {
          type: 'image',
          url: '/assets/seed/product_bibliotheque_noyer_1795278978216.jpg',
          altText: 'Bibliothèque Corniche en noyer massif et acier forgé — vue de face',
        },
        {
          type: 'image',
          url: '/assets/seed/hero_emrod_showroom_1795278978763.jpg',
          altText: 'Bibliothèque Corniche intégrée dans le showroom EMROD Conakry',
        },
        {
          type: 'image',
          url: '/assets/seed/atelier_femmes_artisanes_1795278979185.jpg',
          altText: 'Finitions appliquées à la main par les artisanes EMROD',
        },
      ],
    },
    {
      id: 'prd_console_sonfonia',
      slug: 'console-sonfonia-chene-cuir-pleine-fleur',
      categoryId: 'cat-tables-consoles',
      name: 'Console Sonfonia en Chêne & Cuir Pleine Fleur',
      description:
        'Pièce d’entrée haute couture réunissant un piètement tourné en chêne massif et deux tiroirs gainés de cuir pleine fleur cognac cousu sellier à la main. Ses poignées en bronze martelé soulignent le travail d’orfèvrerie propre à la signature EMROD SARL.',
      materials: 'Chêne massif, cuir pleine fleur cognac, bronze martelé',
      dimensions: 'L 140 × P 40 × H 82 cm',
      weightKg: 34,
      priceGnf: 8900000,
      compareAtPriceGnf: null,
      mode: 'direct',
      stockQty: 4,
      isUniquePiece: 0,
      keywords: ['console', 'chene', 'cuir pleine fleur', 'bronze', 'entree', 'fait main'],
      featured: 1,
      media: [
        {
          type: 'image',
          url: '/assets/seed/product_console_chene_cuir_1795278979332.jpg',
          altText: 'Console Sonfonia en chêne massif avec tiroirs en cuir pleine fleur',
        },
        {
          type: 'image',
          url: '/assets/seed/atelier_femmes_artisanes_1795278979185.jpg',
          altText: 'Contrôle des coutures cuir et ponçage fin à l’atelier EMROD',
        },
      ],
    },
    {
      id: 'prd_table_kaloum',
      slug: 'table-basse-kaloum-noyer-bronze-patine',
      categoryId: 'cat-tables-consoles',
      name: 'Table Basse Kaloum en Noyer & Bronze Patiné',
      description:
        'Un plateau monolithique en noyer de Guinée sélectionné pour son veinage expressif, posé sur un socle sculptural en bronze texturé patiné à la main. Une pièce centrale pensée comme une œuvre fonctionnelle pour les intérieurs contemporains de Conakry.',
      materials: 'Noyer massif de Guinée, bronze texturé patiné à la main',
      dimensions: 'L 135 × P 75 × H 36 cm',
      weightKg: 58,
      priceGnf: 11200000,
      compareAtPriceGnf: 12500000,
      mode: 'direct',
      stockQty: 1,
      isUniquePiece: 1,
      keywords: ['table basse', 'noyer', 'bronze', 'patine', 'piece unique', 'salon'],
      featured: 1,
      media: [
        {
          type: 'image',
          url: '/assets/seed/product_table_basse_metal_1795278978181.jpg',
          altText: 'Table basse Kaloum plateau noyer et socle bronze texturé',
        },
        {
          type: 'image',
          url: '/assets/seed/hero_emrod_showroom_1795278978763.jpg',
          altText: 'Mise en scène salon EMROD',
        },
      ],
    },
    {
      id: 'prd_fauteuil_camayenne',
      slug: 'fauteuil-camayenne-chene-cuir-ambre',
      categoryId: 'cat-assises',
      name: 'Fauteuil Camayenne en Chêne Sculpté & Cuir Ambré',
      description:
        'Structure galbée en chêne massif assemblée par tenons et mortaises chevillés, associée à de généreux coussins en cuir pleine fleur ambré à surpiqûres contrastées. Confort enveloppant et silhouette intemporelle façonnée par notre équipe féminine.',
      materials: 'Chêne massif sculpté, cuir pleine fleur ambré, fil ciré',
      dimensions: 'L 76 × P 84 × H 80 cm',
      weightKg: 24,
      priceGnf: 7600000,
      compareAtPriceGnf: null,
      mode: 'direct',
      stockQty: 5,
      isUniquePiece: 0,
      keywords: ['fauteuil', 'chene', 'cuir', 'salon', 'assise', 'fait main'],
      featured: 1,
      media: [
        {
          type: 'image',
          url: '/assets/seed/product_fauteuil_cuir_bois_1795278979269.jpg',
          altText: 'Fauteuil Camayenne en chêne sculpté et cuir pleine fleur ambré',
        },
        {
          type: 'image',
          url: '/assets/seed/hero_emrod_showroom_1795278978763.jpg',
          altText: 'Fauteuil Camayenne dans un intérieur lumineux',
        },
      ],
    },
    {
      id: 'prd_buffet_virage',
      slug: 'buffet-cannele-virage-chene-fume-laiton',
      categoryId: 'cat-prestige',
      name: 'Buffet Cannelé Virage en Chêne Fumé & Laiton',
      description:
        'Pièce de prestige certifiée EMROD : façades cannelées usinées puis poncées à la main dans un chêne fumé profond, soulignées d’un fin filet de laiton brossé et posées sur un châssis en bronze texturé. Compartiments intérieurs doublés de cuir suédé.',
      materials: 'Chêne fumé massif, laiton brossé, bronze texturé, cuir suédé',
      dimensions: 'L 195 × P 48 × H 78 cm',
      weightKg: 94,
      priceGnf: 19800000,
      compareAtPriceGnf: 21500000,
      mode: 'direct',
      stockQty: 2,
      isUniquePiece: 0,
      keywords: ['buffet', 'cannele', 'chene', 'laiton', 'prestige', 'rangement'],
      featured: 1,
      media: [
        {
          type: 'image',
          url: '/assets/seed/product_buffet_sonfonia_1795278978653.jpg',
          altText: 'Buffet cannelé Virage en chêne fumé avec filets de laiton',
        },
        {
          type: 'image',
          url: '/assets/seed/atelier_femmes_artisanes_1795278979185.jpg',
          altText: 'Travail des artisanes EMROD sur les finitions de bois noble',
        },
      ],
    },
    {
      id: 'prd_projet_bibliotheque_sur_mesure',
      slug: 'ensemble-architectural-sur-mesure-emrod',
      categoryId: 'cat-sur-mesure',
      name: 'Bibliothèque & Boiserie Murale Sur Mesure EMROD',
      description:
        'Conception architecturale intégrale adaptée au millimètre à votre espace à Conakry ou en région. Suivez le processus EMROD en quatre étapes : sélection des essences de bois nobles et cuirs, validation des plans et croquis 3D, façonnage artisanal dans notre atelier de Sonfonia, puis livraison et montage complet.',
      materials: 'Essences au choix (Noyer, Chêne, Iroko), Cuir pleine fleur, Laiton ou Acier',
      dimensions: 'Dimensions entièrement sur mesure',
      weightKg: 140,
      priceGnf: 0,
      compareAtPriceGnf: null,
      mode: 'sur_devis',
      stockQty: 10,
      isUniquePiece: 1,
      keywords: ['sur mesure', 'bibliotheque', 'devis', 'noyer', 'chene', 'architecture', 'conakry'],
      featured: 1,
      media: [
        {
          type: 'image',
          url: '/assets/seed/hero_emrod_showroom_1795278978763.jpg',
          altText: 'Bibliothèque murale architecturale sur mesure EMROD',
        },
        {
          type: 'image',
          url: '/assets/seed/product_bibliotheque_noyer_1795278978216.jpg',
          altText: 'Détail des finitions noyer et laiton sur mesure',
        },
      ],
    },
  ];

  const insertProduct = db.prepare(
    `INSERT INTO products (id, slug, vendor_id, category_id, name, description, materials, dimensions, weight_kg, price_gnf, compare_at_price_gnf, mode, status, stock_qty, is_unique_piece, keywords_json, delivery_config_json, featured, views_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMedia = db.prepare(
    `INSERT INTO product_media (id, product_id, type, url, poster_url, alt_text, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  for (const p of products) {
    await insertProduct.run(
      p.id,
      p.slug,
      emrodUserId,
      p.categoryId,
      p.name,
      p.description,
      p.materials,
      p.dimensions,
      p.weightKg,
      p.priceGnf,
      p.compareAtPriceGnf,
      p.mode,
      p.stockQty,
      p.isUniquePiece,
      JSON.stringify(p.keywords),
      JSON.stringify({
        pickupAvailable: true,
        pickupAddress: 'T7, Corniche Nord, Virage du lac Sonfonia Centre, Conakry',
        estimatedDelay: p.mode === 'sur_devis' ? '3 à 5 semaines selon plan' : '48h à 72h (Conakry)',
        zoneFees: {},
      }),
      p.featured,
      140 + Math.floor(Math.random() * 120),
      now,
      now
    );

    for (let idx = 0; idx < p.media.length; idx++) {
      const m = p.media[idx]!;
      await insertMedia.run(
        `${p.id}_m${idx + 1}`,
        p.id,
        m.type,
        m.url,
        null,
        m.altText,
        idx
      );
    }
  }

  // 6. Seed 2 realistic guest orders with deterministic demo tracking tokens
  const oneYearLater = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const earlierDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  // Order 1: Livrée (with verified review + complete timeline) -> token: emr_demo_livree_2026
  const ord1Id = 'ord_demo_001';
  await db.prepare(
    `INSERT INTO orders (id, order_number, idempotency_key, buyer_name, buyer_email, buyer_phone, delivery_zone_id, delivery_zone_name, delivery_address, delivery_landmark, subtotal_gnf, delivery_fee_gnf, total_gnf, status, tracking_token_hash, tracking_token_expires_at, notifications_enabled, payment_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Livrée', ?, ?, 1, 'redirect', ?, ?)`
  ).run(
    ord1Id,
    'EMR-2026-1042',
    'seed-idem-1042',
    'Aïssatou Diallo',
    'aissatou.diallo@exemple.gn',
    '+224 622 14 78 90',
    'dixinn-matam',
    'Dixinn & Matam',
    'Quartier Camayenne, Rue DI-24',
    'En face de l’ambassade, portail beige',
    8900000,
    120000,
    9020000,
    hashTrackingToken('emr_demo_livree_2026'),
    oneYearLater,
    earlierDate,
    now
  );

  await db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, vendor_id, product_name, product_slug, product_image, quantity, unit_price_gnf, delivery_fee_gnf)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    'oi_demo_1',
    ord1Id,
    'prd_console_sonfonia',
    emrodUserId,
    'Console Sonfonia en Chêne & Cuir Pleine Fleur',
    'console-sonfonia-chene-cuir-pleine-fleur',
    '/assets/seed/product_console_chene_cuir_1795278979332.jpg',
    8900000,
    120000
  );

  const ord1Events = [
    ['Commandée', 'system', 'Système Djomy', 'Paiement Mobile Money autorisé et confirmé.', -8],
    ['Confirmée', 'vendor', 'EMROD SARL', 'Commande acceptée par l’atelier de Sonfonia.', -7],
    ['En préparation', 'vendor', 'EMROD SARL', 'Contrôle des finitions cuir et cire d’abeille terminé.', -5],
    ['Expédiée', 'vendor', 'EMROD SARL', 'Confiée à l’équipe de livraison et montage EMROD.', -3],
    ['En livraison', 'vendor', 'EMROD SARL', 'Chauffeur en route vers Camayenne.', -2],
    ['Livrée', 'vendor', 'EMROD SARL', 'Installée à domicile et signée par la cliente.', -2],
  ] as const;

  for (let idx = 0; idx < ord1Events.length; idx++) {
    const [st, role, actor, comment, daysAgo] = ord1Events[idx]!;
    const dt = new Date(Date.now() + daysAgo * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(
      `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(`oe_1_${idx}`, ord1Id, st, role, actor, comment, dt);
  }

  await db.prepare(
    `INSERT INTO payments (id, order_id, djomy_reference, type, method, operator, amount_gnf, status, raw_webhook_json, created_at, updated_at)
     VALUES (?, ?, ?, 'payment', 'mobile_money', 'Orange Money', ?, 'succeeded', ?, ?, ?)`
  ).run(
    'pay_demo_1',
    ord1Id,
    'DJM-SEED-1042',
    9020000,
    JSON.stringify({ event: 'payment.succeeded', reference: 'DJM-SEED-1042' }),
    earlierDate,
    earlierDate
  );

  await db.prepare(
    `INSERT INTO payouts (id, vendor_id, order_id, amount_gnf, reference, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'paid', ?)`
  ).run('pout_demo_1', emrodUserId, ord1Id, 9020000, 'DJM-PAYOUT-1042', now);

  // Verified Review for Order 1
  await db.prepare(
    `INSERT INTO reviews (id, order_id, product_id, vendor_id, buyer_name, rating, comment, photos_json, vendor_reply, vendor_replied_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, 5, ?, ?, ?, ?, 'published', ?)`
  ).run(
    'rev_demo_1',
    ord1Id,
    'prd_console_sonfonia',
    emrodUserId,
    'Aïssatou Diallo',
    'La finesse des coutures sur le cuir pleine fleur et le toucher du chêne sont remarquables. L’équipe EMROD a livré et installé la console avec grand soin à Camayenne.',
    JSON.stringify(['/assets/seed/product_console_chene_cuir_1795278979332.jpg']),
    'Merci infiniment Madame Diallo pour votre confiance. Nos artisanes de Sonfonia sont ravies de savoir cette pièce chez vous.',
    now,
    now
  );

  // Order 2: En préparation -> token: emr_demo_preparation_2026
  const ord2Id = 'ord_demo_002';
  await db.prepare(
    `INSERT INTO orders (id, order_number, idempotency_key, buyer_name, buyer_email, buyer_phone, delivery_zone_id, delivery_zone_name, delivery_address, delivery_landmark, subtotal_gnf, delivery_fee_gnf, total_gnf, status, tracking_token_hash, tracking_token_expires_at, notifications_enabled, payment_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'En préparation', ?, ?, 1, 'redirect', ?, ?)`
  ).run(
    ord2Id,
    'EMR-2026-1089',
    'seed-idem-1089',
    'Mamadou Saliou Bah',
    'm.bah@exemple.gn',
    '+224 664 33 12 05',
    'kaloum',
    'Kaloum & Centre-ville',
    'Avenue de la République, Immeuble Kaba',
    'Proche du port autonome, 3e étage',
    7600000,
    150000,
    7750000,
    hashTrackingToken('emr_demo_preparation_2026'),
    oneYearLater,
    now,
    now
  );

  await db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, vendor_id, product_name, product_slug, product_image, quantity, unit_price_gnf, delivery_fee_gnf)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    'oi_demo_2',
    ord2Id,
    'prd_fauteuil_camayenne',
    emrodUserId,
    'Fauteuil Camayenne en Chêne Sculpté & Cuir Ambré',
    'fauteuil-camayenne-chene-cuir-ambre',
    '/assets/seed/product_fauteuil_cuir_bois_1795278979269.jpg',
    7600000,
    150000
  );

  await db.prepare(
    `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at) VALUES (?, ?, 'Commandée', 'system', 'Système Djomy', 'Paiement validé via Djomy.', ?)`
  ).run('oe_2_0', ord2Id, now);
  await db.prepare(
    `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at) VALUES (?, ?, 'Confirmée', 'vendor', 'EMROD SARL', 'Commande confirmée.', ?)`
  ).run('oe_2_1', ord2Id, now);
  await db.prepare(
    `INSERT INTO order_events (id, order_id, status, actor_role, actor_name, comment, created_at) VALUES (?, ?, 'En préparation', 'vendor', 'EMROD SARL', 'Sellerie cuir en cours de finition.', ?)`
  ).run('oe_2_2', ord2Id, now);

  await db.prepare(
    `INSERT INTO payments (id, order_id, djomy_reference, type, method, operator, amount_gnf, status, raw_webhook_json, created_at, updated_at)
     VALUES (?, ?, ?, 'payment', 'card', 'Visa', ?, 'succeeded', ?, ?, ?)`
  ).run(
    'pay_demo_2',
    ord2Id,
    'DJM-SEED-1089',
    7750000,
    JSON.stringify({ event: 'payment.succeeded', reference: 'DJM-SEED-1089' }),
    now,
    now
  );

  // Private conversation for Order 2
  await db.prepare(
    `INSERT INTO conversations (id, type, order_id, vendor_id, buyer_name, buyer_email, created_at)
     VALUES ('conv_ord_2', 'order', ?, ?, 'Mamadou Saliou Bah', 'm.bah@exemple.gn', ?)`
  ).run(ord2Id, emrodUserId, now);
  await db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_role, sender_name, content, is_public, created_at)
     VALUES ('msg_ord_2_1', 'conv_ord_2', 'buyer', 'Mamadou Saliou Bah', 'Bonjour, est-il possible de confirmer l’heure de livraison à Kaloum dès que le fauteuil sera prêt ?', 0, ?)`
  ).run(now);
  await db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_role, sender_name, content, is_public, created_at)
     VALUES ('msg_ord_2_2', 'conv_ord_2', 'vendor', 'EMROD SARL', 'Bonjour Monsieur Bah, nos livreurs vous confirmeront le créneau exact 2 heures avant le passage via votre espace de suivi sécurisé EMROD.', 0, ?)`
  ).run(now);

  // Public Q&A on Bibliothèque Corniche
  await db.prepare(
    `INSERT INTO conversations (id, type, product_id, vendor_id, buyer_name, buyer_email, created_at)
     VALUES ('conv_prd_1', 'product', 'prd_biblio_corniche', ?, 'Fodé Bangoura', 'fode@exemple.gn', ?)`
  ).run(emrodUserId, now);
  await db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_role, sender_name, content, is_public, created_at)
     VALUES ('msg_prd_1_1', 'conv_prd_1', 'buyer', 'Fodé Bangoura', 'Le montage mural de la bibliothèque Corniche est-il inclus pour une livraison à Kipé ?', 1, ?)`
  ).run(now);
  await db.prepare(
    `INSERT INTO messages (id, conversation_id, sender_role, sender_name, content, is_public, created_at)
     VALUES ('msg_prd_1_2', 'conv_prd_1', 'vendor', 'EMROD SARL', 'Oui, tout à fait. Notre équipe assure le transport, le réglage des niveaux et la fixation sécurisée à Kipé et dans tout Conakry.', 1, ?)`
  ).run(now);

  // Seed initial notification history (F-PWA-05)
  await db.prepare(
    `INSERT INTO notifications (id, title, body, target_category, target_region, target_url, sent_count, delivered_count, opened_count, unsubscribed_count, created_at)
     VALUES ('notif_seed_1', 'Nouvelle collection Bois Nobles & Cuir', 'Découvrez le Buffet Cannelé Virage et la Console Sonfonia façonnés à Conakry.', 'all', 'Conakry', '/catalogue', 148, 142, 89, 1, ?)`
  ).run(earlierDate);

  logAudit({
    actorId: 'system',
    actorRole: 'system',
    actorName: 'Initialisation EMROD',
    action: 'SEED_DATABASE',
    targetType: 'platform',
    targetId: 'v1',
    after: { products: products.length, categories: categories.length, badges: badges.length },
  });
}

async function ensureAdditionalMarketplaceData(): Promise<void> {
  const now = new Date().toISOString();
  const oneYearLater = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  // Ensure EMROD SARL has bank transfer coordinates configured
  await db.prepare(
    `UPDATE vendor_profiles
     SET bank_transfer_enabled = 1,
         bank_name = 'Vista Bank Guinée — Agence Kaloum',
         bank_account_holder = 'EMROD SARL',
         bank_iban_rib = 'GN94 0010 1001 0048 9201 4400 72',
         bank_swift_bic = 'VISTGNCNXXX',
         bank_instructions = 'Indiquez impérativement votre numéro de commande EMR-... en motif de virement, puis déclarez la référence bancaire sur votre espace de suivi EMROD.'
     WHERE user_id = 'usr_emrod_official' AND bank_iban_rib = ''`
  ).run();

  // Backfill legacy orders amount_paid_now_gnf — uniquement celles dont le
  // paiement est réellement 'succeeded' : les commandes 'full' en attente de
  // paiement sont légitimement à amount_paid = 0 depuis la création (le
  // checkout n'insère plus le montant *planifié* comme encaissé).
  await db.prepare(
    `UPDATE orders SET amount_paid_now_gnf = total_gnf, balance_due_gnf = 0
     WHERE payment_plan = 'full' AND amount_paid_now_gnf = 0 AND total_gnf > 0
       AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND p.status = 'succeeded')`
  ).run();

  // Sanitize seeded message with legacy phone number
  await db.prepare(
    `UPDATE messages
     SET content = 'Bonjour Monsieur Bah, nos livreurs vous confirmeront le créneau exact 2 heures avant le passage via votre espace de suivi sécurisé EMROD.'
     WHERE id = 'msg_ord_2_2' AND content LIKE '%664 33 12 05%'`
  ).run();

  // Merge new defaults into existing commercial_restrictions rule
  const existingRestr = await db
    .prepare(`SELECT value_json FROM platform_rules WHERE key = 'commercial_restrictions'`)
    .get() as { value_json: string } | undefined;
  if (existingRestr) {
    try {
      const parsed = JSON.parse(existingRestr.value_json);
      if (parsed.defaultDepositPercent === undefined || parsed.bankTransferMinGnf === undefined) {
        const merged = {
          ...parsed,
          defaultDepositPercent: parsed.defaultDepositPercent ?? 30,
          bankTransferMinGnf: parsed.bankTransferMinGnf ?? 15000000,
        };
        await db.prepare(`UPDATE platform_rules SET value_json = ?, updated_at = ? WHERE key = 'commercial_restrictions'`).run(
          JSON.stringify(merged),
          now
        );
      }
    } catch {
      // ignore parse issue
    }
  }

  // Ensure a second validated 3P atelier exists so vendor search/filtering works out of the box
  const foutaId = 'usr_atelier_fouta';
  const existingFouta = await db.prepare(`SELECT id FROM users WHERE id = ?`).get(foutaId);
  if (!existingFouta) {
    const foutaPassword = getSeedPassword('SEED_VENDOR_FOUTA_PASSWORD', 'Vendeur Atelier Fouta (contact@atelier-fouta.gn)');
    await db.prepare(
      `INSERT INTO users (id, email, phone, password_hash, role, status, status_reason, email_verified, phone_verified, entity_type, created_at)
       VALUES (?, ?, ?, ?, 'vendor', 'validated', 'Atelier partenaire certifié EMROD', 1, 1, 'company', ?)`
    ).run(foutaId, 'contact@atelier-fouta.gn', '+224 628 55 10 22', hashPassword(foutaPassword), now);

    await db.prepare(
      `INSERT INTO vendor_profiles (user_id, slug, shop_name, description, story, location, logo_url, is_emrod_official, default_zones_json, response_time_label, custom_fields_json, bank_transfer_enabled, bank_name, bank_account_holder, bank_iban_rib, bank_swift_bic, bank_instructions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
    ).run(
      foutaId,
      'atelier-fouta-cuir',
      'Atelier Fouta & Cuir',
      'Ébénisterie contemporaine du Fouta-Djalon : tables de réception en iroko massif et assises sellier en cuir tanné végétal.',
      'Installé à Dixinn Camayenne depuis 2019, l’Atelier Fouta & Cuir rassemble des maîtres menuisiers et maroquiniers guinéens engagés sur la traçabilité des bois nobles.',
      'Dixinn, Camayenne, Conakry',
      '/assets/seed/product_console_chene_cuir_1795278979332.jpg',
      JSON.stringify(['kaloum', 'dixinn-matam', 'ratoma-sonfonia']),
      'Répond sous 3 heures',
      JSON.stringify({ specialty: 'Cuirs pleine fleur' }),
      'Société Générale Guinée — Kaloum',
      'Atelier Fouta & Cuir SARLU',
      'GN52 0020 2001 0091 3402 8800 19',
      'SGGNGNCNXXX',
      'Mentionnez la référence EMR-... et transmettez l’avis de virement dans le suivi de commande EMROD.',
      now
    );

    await db.prepare(
      `INSERT INTO kyc_documents (id, vendor_id, doc_type, doc_label, file_name, file_data_url, status, reviewer_id, created_at, updated_at)
       VALUES (?, ?, 'id_card', 'Pièce d’identité nationale ou Passeport', 'CNI-Fouta.jpg', '/assets/seed/atelier_femmes_artisanes_1795278979185.jpg', 'approved', 'usr_emrod_official', ?, ?)`
    ).run('doc_fouta_id', foutaId, now, now);

    await db.prepare(
      `INSERT INTO certifications (id, vendor_id, badge_id, granted_by, status, created_at) VALUES (?, ?, 'badge-vendeur-certifie', 'usr_emrod_official', 'active', ?)`
    ).run('cert_fouta_1', foutaId, now);

    const fProducts = [
      {
        id: 'prd_fouta_table_iroko',
        slug: 'table-reception-iroko-atelier-fouta',
        categoryId: 'cat-tables-consoles',
        name: 'Table de Réception Dalaba en Iroko Massif & Acier',
        description:
          'Grande table de salle à manger ou de réunion façonnée en iroko massif du Fouta avec chant naturel adouci et piètement trapèze en acier thermolaqué noir mat. Finition vernis satiné résistant à la chaleur.',
        materials: 'Iroko massif du Fouta, acier thermolaqué noir',
        dimensions: 'L 240 × P 105 × H 76 cm',
        weightKg: 98,
        priceGnf: 16800000,
        stockQty: 2,
        keywords: ['table', 'iroko', 'acier', 'salle a manger', 'fouta', 'dixinn'],
        img: '/assets/seed/product_table_basse_metal_1795278978181.jpg',
      },
      {
        id: 'prd_fouta_buffet_dixinn',
        slug: 'enfilade-camayenne-iroko-cuir-tresse',
        categoryId: 'cat-rangements',
        name: 'Enfilade Camayenne en Iroko & Cuir Tressé',
        description:
          'Enfilade basse quatre portes alliant caisson en bois d’iroko sélectionné et façades ornées de lanières de cuir pleine fleur tressées à la main. Étagères intérieures réglables et charnières amorties.',
        materials: 'Iroko massif, cuir pleine fleur tressé, laiton',
        dimensions: 'L 185 × P 45 × H 74 cm',
        weightKg: 68,
        priceGnf: 12400000,
        stockQty: 3,
        keywords: ['enfilade', 'buffet', 'iroko', 'cuir', 'rangement', 'fait main'],
        img: '/assets/seed/product_buffet_sonfonia_1795278978653.jpg',
      },
    ];

    for (const fp of fProducts) {
      await db.prepare(
        `INSERT INTO products (id, slug, vendor_id, category_id, name, description, materials, dimensions, weight_kg, price_gnf, compare_at_price_gnf, mode, status, stock_qty, is_unique_piece, keywords_json, delivery_config_json, featured, views_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'direct', 'published', ?, 0, ?, ?, 0, 95, ?, ?)`
      ).run(
        fp.id,
        fp.slug,
        foutaId,
        fp.categoryId,
        fp.name,
        fp.description,
        fp.materials,
        fp.dimensions,
        fp.weightKg,
        fp.priceGnf,
        fp.stockQty,
        JSON.stringify(fp.keywords),
        JSON.stringify({
          pickupAvailable: true,
          pickupAddress: 'Camayenne, Dixinn, Conakry',
          estimatedDelay: '72h (Conakry)',
          zoneFees: {},
        }),
        now,
        now
      );
      await db.prepare(
        `INSERT INTO product_media (id, product_id, type, url, poster_url, alt_text, sort_order) VALUES (?, ?, 'image', ?, NULL, ?, 0)`
      ).run(`${fp.id}_m1`, fp.id, fp.img, fp.name);
    }

    // Seed 1 delivered order for Atelier Fouta & Cuir so sales filtering & reviews have real multi-vendor data
    const foutaOrdId = 'ord_demo_fouta_003';
    await db.prepare(
      `INSERT INTO orders (id, order_number, idempotency_key, buyer_name, buyer_email, buyer_phone, delivery_zone_id, delivery_zone_name, delivery_address, delivery_landmark, subtotal_gnf, delivery_fee_gnf, total_gnf, status, tracking_token_hash, tracking_token_expires_at, notifications_enabled, payment_mode, payment_plan, deposit_percent, amount_paid_now_gnf, balance_due_gnf, created_at, updated_at)
       VALUES (?, 'EMR-2026-1055', 'seed-idem-1055', 'Mariama Condé', 'm.conde@exemple.gn', '+224 625 90 11 44', 'ratoma-sonfonia', 'Ratoma, Kipé & Sonfonia', 'Kipé Centre Émetteur', 'Immeuble Horizon', 12400000, 150000, 12550000, 'Livrée', ?, ?, 1, 'redirect', 'full', 100, 12550000, 0, ?, ?)`
    ).run(foutaOrdId, hashTrackingToken('emr_demo_fouta_2026'), oneYearLater, now, now);

    await db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, vendor_id, product_name, product_slug, product_image, quantity, unit_price_gnf, delivery_fee_gnf)
       VALUES ('oi_demo_fouta_1', ?, 'prd_fouta_buffet_dixinn', ?, 'Enfilade Camayenne en Iroko & Cuir Tressé', 'enfilade-camayenne-iroko-cuir-tresse', '/assets/seed/product_buffet_sonfonia_1795278978653.jpg', 1, 12400000, 150000)`
    ).run(foutaOrdId, foutaId);

    await db.prepare(
      `INSERT INTO reviews (id, order_id, product_id, vendor_id, buyer_name, rating, comment, photos_json, status, created_at)
       VALUES ('rev_demo_fouta_1', ?, 'prd_fouta_buffet_dixinn', ?, 'Mariama Condé', 5, 'Bois d’iroko splendide et tressage cuir très régulier. Livraison ponctuelle à Kipé.', '[]', 'published', ?)`
    ).run(foutaOrdId, foutaId, now);
  }
}

/**
 * Boot unique de la base : schéma, migrations, seeds. Appelé par server.ts
 * avant d'écouter le port (les requêtes exigent un schéma complet).
 */
export async function initDatabase(): Promise<void> {
  await initSchema();
  await seedDatabase();
  await ensureAdditionalMarketplaceData();
  printGeneratedSeedPasswords();
  await purgeDemoData();
}

/**
 * Optional production bootstrap: PURGE_DEMO_DATA=true removes the seeded
 * showcase data (orders, reviews, payouts, notifications, published Fouta
 * products, fictitious bank details) so the platform opens with a clean slate.
 * Idempotent — runs at most once per database.
 */
export async function purgeDemoData(): Promise<void> {
  if (process.env.PURGE_DEMO_DATA?.trim().toLowerCase() !== 'true') return;
  const alreadyPurged = await db
    .prepare(`SELECT key FROM platform_rules WHERE key = 'demo_purged_at'`)
    .get();
  if (alreadyPurged) return;

  const now = new Date().toISOString();
  const demoOrderIds = ['ord_demo_001', 'ord_demo_002', 'ord_demo_fouta_003'];
  const placeholders = demoOrderIds.map(() => '?').join(',');

  // Cascade-friendly deletes (explicit for tables without FK cascades)
  const orderIds = (
    await db
      .prepare(
        `SELECT id FROM orders WHERE id IN (${placeholders}) OR idempotency_key LIKE 'seed-idem-%'`
      )
      .all(...demoOrderIds) as Array<{ id: string }>
  ).map((r) => r.id);
  for (const orderId of orderIds) {
    await db.prepare(`DELETE FROM order_events WHERE order_id = ?`).run(orderId);
    await db.prepare(`DELETE FROM order_items WHERE order_id = ?`).run(orderId);
    await db.prepare(`DELETE FROM reviews WHERE order_id = ?`).run(orderId);
    await db.prepare(`DELETE FROM payments WHERE order_id = ?`).run(orderId);
    await db.prepare(`DELETE FROM payouts WHERE order_id = ?`).run(orderId);
    await db.prepare(`DELETE FROM conversations WHERE order_id = ?`).run(orderId);
    await db.prepare(`DELETE FROM orders WHERE id = ?`).run(orderId);
  }
  await db.prepare(`DELETE FROM notifications`).run();

  // Fouta is a demo third-party atelier: unpublish its products and remove the
  // fictitious bank details so buyers can never be instructed to wire money to it.
  await db.prepare(
    `UPDATE products SET status = 'archived' WHERE vendor_id = 'usr_atelier_fouta' AND status = 'published'`
  ).run();
  await db.prepare(
    `UPDATE vendor_profiles
     SET bank_transfer_enabled = 0, bank_name = '', bank_account_holder = '', bank_iban_rib = '', bank_swift_bic = '', bank_instructions = ''
     WHERE user_id = 'usr_atelier_fouta'`
  ).run();

  await db.prepare(
    `INSERT INTO platform_rules (key, value_json, updated_at) VALUES ('demo_purged_at', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`
  ).run(JSON.stringify({ at: now }), now);
  console.log('[db] Données de démonstration purgées (PURGE_DEMO_DATA=true).');
}
