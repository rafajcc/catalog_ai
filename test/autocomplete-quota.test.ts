// Tests for the per-comercio autocomplete quota: the counter (reserve /
// release / billing cycle rollover) and the super admin routes that configure
// it and produce the CSV audit report.
//
// The counter tests call reserveAutocompleteCall directly against a temp
// database; the route tests boot a real app like image-providers.test.ts does.

import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import createApp from '../backend/src/app';
import { hashPassword } from '../backend/src/modules/auth/auth';
import { initDatabase } from '../backend/src/modules/auth';
import { MockAIProvider } from '../backend/src/modules/ai-providers/providers/mock';
import {
  addAutocompleteAuditLog,
  createRegistrationNonce,
  generateNonceCode,
  getAutocompleteQuota,
  updateAutocompleteQuota
} from '../backend/src/modules/auth/database';
import {
  normaliseBillingCycleDay,
  normaliseMonthlyLimit,
  QUOTA_DISABLED,
  QUOTA_UNLIMITED,
  releaseAutocompleteCall,
  reserveAutocompleteCall
} from '../backend/src/modules/autocomplete-quota/quota';

jest.setTimeout(30000);

const ADMIN_USERNAME = 'root';
const ADMIN_PASSWORD_PLAIN = 'Super.Admin.1';
let adminPasswordHash = '';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function resetDb() {
  await initDatabase(makeTempDir('catalogai-quota-'));
}

beforeAll(async () => {
  adminPasswordHash = await hashPassword(ADMIN_PASSWORD_PLAIN);
});

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('autocomplete quota counter', () => {
  it('is disabled by default: a never-configured comercio cannot autocomplete', async () => {
    await resetDb();
    const decision = reserveAutocompleteCall(1);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('disabled');
    expect(decision.limit).toBe(QUOTA_DISABLED);
  });

  it('never lets the calls pass the configured limit', async () => {
    await resetDb();
    updateAutocompleteQuota(1, { monthly_limit: 5, billing_cycle_day: 1 });

    for (let i = 0; i < 5; i++) {
      expect(reserveAutocompleteCall(1).allowed).toBe(true);
    }

    const denied = reserveAutocompleteCall(1);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('exhausted');
    expect(denied.used).toBe(5);
    expect(denied.remaining).toBe(0);
  });

  it('gives the slot back when the AI answer does not count', async () => {
    await resetDb();
    updateAutocompleteQuota(1, { monthly_limit: 2, billing_cycle_day: 1 });

    const first = reserveAutocompleteCall(1);
    expect(first.allowed).toBe(true);
    expect(getAutocompleteQuota(1)?.calls_this_cycle).toBe(1);

    // The call failed, so the reserved slot is refunded and the next request
    // still fits in the limit.
    releaseAutocompleteCall(1, first.cycleStart!);
    expect(getAutocompleteQuota(1)?.calls_this_cycle).toBe(0);
    expect(reserveAutocompleteCall(1).allowed).toBe(true);
  });

  it('does not count a call that the AI answered with valid JSON', async () => {
    await resetDb();
    updateAutocompleteQuota(1, { monthly_limit: 3, billing_cycle_day: 1 });

    // Kept (no release call) => consumed.
    reserveAutocompleteCall(1);
    reserveAutocompleteCall(1);
    expect(getAutocompleteQuota(1)?.calls_this_cycle).toBe(2);
    expect(reserveAutocompleteCall(1).allowed).toBe(true);
    expect(reserveAutocompleteCall(1).allowed).toBe(false);
  });

  it('keeps the counter accurate when several users reserve at the same time', async () => {
    await resetDb();
    updateAutocompleteQuota(1, { monthly_limit: 5, billing_cycle_day: 1 });

    // Ten concurrent users each try to reserve; exactly five may pass. The
    // counter is the single source of truth, so the ten decisions cannot all
    // read the same starting value.
    const decisions = await Promise.all(
      Array.from({ length: 10 }, async () => reserveAutocompleteCall(1))
    );

    expect(decisions.filter((d) => d.allowed)).toHaveLength(5);
    expect(decisions.filter((d) => !d.allowed)).toHaveLength(5);
    expect(getAutocompleteQuota(1)?.calls_this_cycle).toBe(5);
  });

  it('never drops below zero when a release happens twice', async () => {
    await resetDb();
    updateAutocompleteQuota(1, { monthly_limit: 2, billing_cycle_day: 1 });

    const decision = reserveAutocompleteCall(1);
    releaseAutocompleteCall(1, decision.cycleStart!);
    releaseAutocompleteCall(1, decision.cycleStart!);

    expect(getAutocompleteQuota(1)?.calls_this_cycle).toBe(0);
  });

  it('allows every call when the limit is unlimited', async () => {
    await resetDb();
    updateAutocompleteQuota(1, { monthly_limit: QUOTA_UNLIMITED, billing_cycle_day: 1 });

    for (let i = 0; i < 50; i++) {
      const decision = reserveAutocompleteCall(1);
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBeNull();
    }
  });

  it('restarts the period when the billing cycle day has passed', async () => {
    await resetDb();
    updateAutocompleteQuota(1, { monthly_limit: 5, billing_cycle_day: 15 });
    // Simulate a counter left over from a previous period.
    updateAutocompleteQuota(1, { calls_this_cycle: 5, cycle_start: '2000-01-01' });

    const decision = reserveAutocompleteCall(1);
    expect(decision.allowed).toBe(true);
    expect(decision.used).toBe(1);
    expect(getAutocompleteQuota(1)?.calls_this_cycle).toBe(1);
  });

  it('does not refund a slot into a period that has already rolled over', async () => {
    await resetDb();
    updateAutocompleteQuota(1, { monthly_limit: 5, billing_cycle_day: 1 });
    // The row already sits in a newer period than the one this slot was taken in.
    updateAutocompleteQuota(1, { calls_this_cycle: 3, cycle_start: '2999-01-01' });

    // A late refund from the previous period must not touch the new counter.
    releaseAutocompleteCall(1, '2000-01-01');
    expect(getAutocompleteQuota(1)?.calls_this_cycle).toBe(3);
  });

  it('counts only the calls that produced a valid AI answer', async () => {
    await resetDb();
    updateAutocompleteQuota(1, { monthly_limit: 3, billing_cycle_day: 1 });

    // Simulate the route settling three slots: one valid answer (kept) and two
    // failures (refunded). The counter must end at 1.
    const valid = reserveAutocompleteCall(1);
    const failedA = reserveAutocompleteCall(1);
    const failedB = reserveAutocompleteCall(1);
    expect(getAutocompleteQuota(1)?.calls_this_cycle).toBe(3);

    releaseAutocompleteCall(1, failedA.cycleStart!);
    releaseAutocompleteCall(1, failedB.cycleStart!);

    expect(getAutocompleteQuota(1)?.calls_this_cycle).toBe(1);
    expect(valid.allowed).toBe(true);
  });
});

describe('quota settings validation', () => {
  it('accepts only 0 (disabled), -1 (unlimited) or a positive number of calls', () => {
    expect(normaliseMonthlyLimit(-1)).toBe(QUOTA_UNLIMITED);
    expect(normaliseMonthlyLimit(0)).toBe(QUOTA_DISABLED);
    expect(normaliseMonthlyLimit(25)).toBe(25);
    expect(normaliseMonthlyLimit('40')).toBe(40);
  });

  it('rejects anything else instead of guessing a limit', () => {
    // A typo like -9 must not silently become "unlimited", which would hand out
    // free quota the super admin never meant to grant.
    expect(normaliseMonthlyLimit(-9)).toBeNull();
    expect(normaliseMonthlyLimit(-0.5)).toBeNull();
    expect(normaliseMonthlyLimit(4.5)).toBeNull();
    expect(normaliseMonthlyLimit('nonsense')).toBeNull();
    expect(normaliseMonthlyLimit('')).toBeNull();
    expect(normaliseMonthlyLimit(null)).toBeNull();
    expect(normaliseMonthlyLimit(undefined)).toBeNull();
    expect(normaliseMonthlyLimit(Number.NaN)).toBeNull();
  });

  it('accepts only billing cycle days between 1 and 28', () => {
    expect(normaliseBillingCycleDay(1)).toBe(1);
    expect(normaliseBillingCycleDay(28)).toBe(28);
    expect(normaliseBillingCycleDay(29)).toBeNull();
    expect(normaliseBillingCycleDay(0)).toBeNull();
    expect(normaliseBillingCycleDay(4.5)).toBeNull();
    expect(normaliseBillingCycleDay(undefined)).toBe(1);
  });
});

describe('autocomplete quota super admin API', () => {
  function extractCookies(res: request.Response): string[] {
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    return cookies.map((c) => c.split(';')[0]);
  }

  async function makeApp() {
    return createApp({ dataDir: makeTempDir('catalogai-quota-api-') });
  }

  function setSuperAdminEnv(enabled: boolean) {
    if (enabled) {
      process.env.ADMIN_USER = ADMIN_USERNAME;
      process.env.ADMIN_PASSWORD = adminPasswordHash;
    } else {
      delete process.env.ADMIN_USER;
      delete process.env.ADMIN_PASSWORD;
    }
  }

  async function loginAsSuperAdmin(app: Awaited<ReturnType<typeof createApp>>) {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD_PLAIN });
    return extractCookies(res);
  }

  // Registers a comercio through the public flow and returns its cookies.
  async function registerComercio(app: Awaited<ReturnType<typeof createApp>>, name: string) {
    const nonce = createRegistrationNonce(
      generateNonceCode(),
      new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      'test-root'
    );
    await request(app).post('/api/auth/register-comercio').send({
      comercio_name: name,
      admin_username: 'admin',
      admin_password: 'Str0ng!Password',
      nonce: nonce.code
    });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Str0ng!Password' });
    return extractCookies(login);
  }

  it('lists every comercio with its quota, including the disabled default', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    // The super admin has no comercio of its own, so one is registered to give
    // the list (and the LEFT JOIN over never-configured rows) something to show.
    await registerComercio(app, 'Tienda Listada');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const res = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    // A comercio that was never configured still appears, with the disabled default.
    const row = res.body.data.find((item: any) => item.comercio_name === 'Tienda Listada');
    expect(row.monthly_limit).toBe(0);
    expect(row.unlimited).toBe(false);
    expect(row.calls_this_cycle).toBe(0);
    expect(row.remaining).toBe(0);
    expect(row.billing_cycle_day).toBe(1);
  });

  it('updates the limit and the billing cycle day of one comercio', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda Quota');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const comercio = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Quota');

    const updated = await request(app)
      .put(`/api/superadmin/autocomplete-quota/${comercio.comercio_id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 100, billing_cycle_day: 15 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.monthly_limit).toBe(100);
    expect(updated.body.data.billing_cycle_day).toBe(15);
    expect(updated.body.data.remaining).toBe(100);

    // The saved settings now let that comercio autocomplete.
    const listAfter = await request(app)
      .get('/api/superadmin/autocomplete-quota')
      .set('Cookie', adminCookies);
    const after = listAfter.body.data.find((row: any) => row.comercio_id === comercio.comercio_id);
    expect(after.monthly_limit).toBe(100);
    expect(comercioCookies.length).toBeGreaterThan(0);
  });

  it('marks an unlimited quota as unlimited with no remaining count', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Sin Limite');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const comercio = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Sin Limite');

    const updated = await request(app)
      .put(`/api/superadmin/autocomplete-quota/${comercio.comercio_id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: -1, billing_cycle_day: 1 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.unlimited).toBe(true);
    expect(updated.body.data.remaining).toBeNull();
  });

  it('rejects an invalid billing cycle day and a missing limit', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Bad');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const comercio = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Bad');

    const badDay = await request(app)
      .put(`/api/superadmin/autocomplete-quota/${comercio.comercio_id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 10, billing_cycle_day: 31 });
    expect(badDay.status).toBe(400);

    const missingLimit = await request(app)
      .put(`/api/superadmin/autocomplete-quota/${comercio.comercio_id}`)
      .set('Cookie', adminCookies)
      .send({ billing_cycle_day: 5 });
    expect(missingLimit.status).toBe(400);
  });

  it('resets the counter of the current period without changing the settings', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Reset');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const comercio = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Reset');
    const id = comercio.comercio_id;

    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 20, billing_cycle_day: 1 });
    updateAutocompleteQuota(id, { calls_this_cycle: 7 });

    const reset = await request(app)
      .post(`/api/superadmin/autocomplete-quota/${id}/reset-calls`)
      .set('Cookie', adminCookies);
    expect(reset.status).toBe(200);
    expect(reset.body.data.calls_this_cycle).toBe(0);
    expect(reset.body.data.monthly_limit).toBe(20);
  });

  it('downloads the audit report as a CSV with the requested filters', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda CSV');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const comercio = listed.body.data.find((row: any) => row.comercio_name === 'Tienda CSV');
    const id = comercio.comercio_id;

    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 2, billing_cycle_day: 1 });

    // Two successful calls, then a third that the limit blocks.
    for (const reference of ['REF-A', 'REF-B']) {
      const res = await request(app)
        .post('/api/autocomplete')
        .set('Cookie', comercioCookies)
        .send({
          language: 'es',
          product: {
            id: 'p1',
            status: 'pending',
            source_file: 'PrestaShop',
            validation_errors: [],
            warnings: [],
            reference,
            brand: 'Nike',
            description: '',
            description_short: '',
            meta_title: '',
            meta_description: ''
          }
        });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/api/autocomplete')
      .set('Cookie', comercioCookies)
      .send({
        language: 'es',
        product: {
          id: 'p3',
          status: 'pending',
          source_file: 'PrestaShop',
          validation_errors: [],
          warnings: [],
          reference: 'REF-C',
          brand: 'Nike',
          description: '',
          description_short: '',
          meta_title: '',
          meta_description: ''
        }
      });
    // The limit of 2 is already consumed, so the third call is refused before
    // any provider is called.
    expect(blocked.status).toBe(429);

    const today = new Date().toISOString().slice(0, 10);
    const csv = await request(app)
      .get(`/api/superadmin/autocomplete-quota/audit-log.csv?comercio_id=${id}&from=${today}&to=${today}`)
      .set('Cookie', adminCookies);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    // Every id travels next to its name, so the file can be read on its own.
    expect(csv.text).toContain(
      'comercio_id,comercio_name,user_id,user_name,ai_provider_id,ai_provider_name,status,brand,reference,ean,requested_at'
    );
    expect(csv.text).toContain('"Tienda CSV"');
    expect(csv.text).toContain('"admin"');
    expect(csv.text).toContain('REF-A');
    expect(csv.text).toContain('REF-B');
    // A call that never reached the provider leaves no evidence behind.
    expect(csv.text).not.toContain('REF-C');

    const json = await request(app)
      .get(`/api/superadmin/autocomplete-quota/audit-log?comercio_id=${id}&from=${today}&to=${today}`)
      .set('Cookie', adminCookies);
    expect(json.status).toBe(200);
    expect(json.body.data.rows).toHaveLength(2);
    expect(json.body.data.total).toBe(2);
    expect(json.body.data.limit).toBe(50);
  });

  it('shows the 50 newest calls on screen and keeps them all in the CSV', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Muchas');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const id = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Muchas').comercio_id;

    // 60 consumed calls, written straight into the audit table (making 60 real
    // AI calls would test the provider, not the report).
    for (let i = 0; i < 60; i++) {
      addAutocompleteAuditLog({
        comercio_id: id,
        user_id: 1,
        ai_provider_id: null,
        ai_provider_name: 'mock',
        status: 'ok',
        product_reference: `REF-${i}`
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const json = await request(app)
      .get(`/api/superadmin/autocomplete-quota/audit-log?comercio_id=${id}&from=${today}&to=${today}`)
      .set('Cookie', adminCookies);

    // The panel shows a bounded table, but it says how many calls the period has
    // so a truncated table cannot be read as the whole period.
    expect(json.body.data.rows).toHaveLength(50);
    expect(json.body.data.total).toBe(60);
    expect(json.body.data.limit).toBe(50);

    const csv = await request(app)
      .get(`/api/superadmin/autocomplete-quota/audit-log.csv?comercio_id=${id}&from=${today}&to=${today}`)
      .set('Cookie', adminCookies);
    // The CSV is the evidence file: it carries every row of the range.
    expect(csv.text.trim().split('\r\n')).toHaveLength(61);
  });

  it('records the product and the caller of every consumed call', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda Evidencia');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const id = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Evidencia').comercio_id;
    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 10, billing_cycle_day: 1 });

    await request(app)
      .post('/api/autocomplete')
      .set('Cookie', comercioCookies)
      .send({
        language: 'es',
        product: {
          id: 'p1',
          status: 'pending',
          source_file: 'PrestaShop',
          validation_errors: [],
          warnings: [],
          reference: 'REF-EV',
          brand: 'ACME',
          ean: '5901234123457',
          description: '',
          description_short: '',
          meta_title: '',
          meta_description: ''
        }
      });

    const today = new Date().toISOString().slice(0, 10);
    const json = await request(app)
      .get(`/api/superadmin/autocomplete-quota/audit-log?comercio_id=${id}&from=${today}&to=${today}`)
      .set('Cookie', adminCookies);

    expect(json.body.data.rows).toHaveLength(1);
    const row = json.body.data.rows[0];
    // Everything the audit log promises to keep as evidence of the call.
    expect(row.comercio_id).toBe(id);
    // The report speaks in names, not in ids: a super admin recognises the
    // comercio and the user that spent the call at a glance.
    expect(row.comercio_name).toBe('Tienda Evidencia');
    expect(row.user_name).toBe('admin');
    expect(row.user_id).toBeGreaterThan(0);
    expect(row.ai_provider_name).toBe('mock');
    expect(row.status).toBe('ok');
    expect(row.product_brand).toBe('ACME');
    expect(row.product_reference).toBe('REF-EV');
    expect(row.product_ean).toBe('5901234123457');
    expect(row.requested_at).toBeTruthy();
  });

  it('does not consume quota when the AI is not asked at all', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda Sin Campos');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const id = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Sin Campos').comercio_id;
    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 5, billing_cycle_day: 1 });

    // All four text fields are already filled, so no provider is called and
    // there is nothing to charge the comercio for.
    const res = await request(app)
      .post('/api/autocomplete')
      .set('Cookie', comercioCookies)
      .send({
        language: 'es',
        product: {
          id: 'p1',
          status: 'pending',
          source_file: 'PrestaShop',
          validation_errors: [],
          warnings: [],
          reference: 'REF-LLENO',
          brand: 'Nike',
          description: '<p>Ya escrito</p>',
          description_short: 'Ya escrito',
          meta_title: 'Ya escrito',
          meta_description: 'Ya escrito'
        }
      });

    expect(res.status).toBe(200);
    expect(getAutocompleteQuota(id)?.calls_this_cycle).toBe(0);

    const today = new Date().toISOString().slice(0, 10);
    const json = await request(app)
      .get(`/api/superadmin/autocomplete-quota/audit-log?comercio_id=${id}&from=${today}&to=${today}`)
      .set('Cookie', adminCookies);
    expect(json.body.data.rows).toHaveLength(0);
    expect(json.body.data.total).toBe(0);
  });

  it('refunds the call when the provider answers with a status outside the contract', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda Status Raro');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const id = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Status Raro').comercio_id;
    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 5, billing_cycle_day: 1 });

    // Valid JSON, but a status the response contract does not allow: the answer
    // is not usable, so it must not cost the comercio a call.
    const spy = jest
      .spyOn(MockAIProvider.prototype, 'complete')
      .mockResolvedValue(JSON.stringify({ status: 'made_up_status', proposals: {} }));

    try {
      const res = await request(app)
        .post('/api/autocomplete')
        .set('Cookie', comercioCookies)
        .send({
          language: 'es',
          product: {
            id: 'p1',
            status: 'pending',
            source_file: 'PrestaShop',
            validation_errors: [],
            warnings: [],
            reference: 'REF-RARO',
            brand: 'Nike',
            description: '',
            description_short: '',
            meta_title: '',
            meta_description: ''
          }
        });

      // The answer is still returned to the grid, it is simply not billed.
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('made_up_status');
      expect(getAutocompleteQuota(id)?.calls_this_cycle).toBe(0);

      const today = new Date().toISOString().slice(0, 10);
      const json = await request(app)
        .get(`/api/superadmin/autocomplete-quota/audit-log?comercio_id=${id}&from=${today}&to=${today}`)
        .set('Cookie', adminCookies);
      expect(json.body.data.rows).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('accepts every status of the contract as a consumed call', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda Sin Datos');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const id = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Sin Datos').comercio_id;
    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 10, billing_cycle_day: 1 });

    // "insufficient_data" is a perfectly valid answer: the provider replied with
    // the contract, so the call was really made and is charged.
    const spy = jest
      .spyOn(MockAIProvider.prototype, 'complete')
      .mockResolvedValue(JSON.stringify({ status: 'insufficient_data', warnings: ['no data'], proposals: {} }));

    try {
      const res = await request(app)
        .post('/api/autocomplete')
        .set('Cookie', comercioCookies)
        .send({
          language: 'es',
          product: {
            id: 'p1',
            status: 'pending',
            source_file: 'PrestaShop',
            validation_errors: [],
            warnings: [],
            reference: 'REF-SIN-DATOS',
            brand: 'Nike',
            description: '',
            description_short: '',
            meta_title: '',
            meta_description: ''
          }
        });

      expect(res.status).toBe(200);
      expect(getAutocompleteQuota(id)?.calls_this_cycle).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('never charges the super admin, who has no comercio', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const adminCookies = await loginAsSuperAdmin(app);

    // The super admin belongs to no commerce (id 0) and configures/tests the
    // providers itself. It never takes a slot, so no quota row is ever created
    // for it.
    const res = await request(app)
      .post('/api/autocomplete')
      .set('Cookie', adminCookies)
      .send({
        language: 'es',
        product: {
          id: 'p1',
          status: 'pending',
          source_file: 'PrestaShop',
          validation_errors: [],
          warnings: [],
          reference: 'REF-ROOT',
          brand: 'Nike',
          description: '',
          description_short: '',
          meta_title: '',
          meta_description: ''
        }
      });

    // (The route has no per-comercio store for the super admin, so it never
    // reaches the quota code; what matters is that no row was written for the
    // non-existent comercio 0.)
    expect(getAutocompleteQuota(0)).toBeUndefined();
    expect(res.status).not.toBe(429);
  });

  it('rejects a limit that is neither 0, -1 nor a positive number', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    await registerComercio(app, 'Tienda Limite Malo');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const id = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Limite Malo').comercio_id;

    const negative = await request(app)
      .put(`/api/superadmin/autocomplete-quota/${id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: -9, billing_cycle_day: 1 });
    expect(negative.status).toBe(400);

    const text = await request(app)
      .put(`/api/superadmin/autocomplete-quota/${id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 'many', billing_cycle_day: 1 });
    expect(text.status).toBe(400);

    // The rejected values were never stored, so the comercio is still disabled.
    expect(getAutocompleteQuota(id)?.monthly_limit ?? QUOTA_DISABLED).toBe(QUOTA_DISABLED);
  });

  it('refuses to configure a comercio that does not exist', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const adminCookies = await loginAsSuperAdmin(app);

    const missing = await request(app)
      .put('/api/superadmin/autocomplete-quota/9999')
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 10, billing_cycle_day: 1 });
    expect(missing.status).toBe(404);

    const invalid = await request(app)
      .put('/api/superadmin/autocomplete-quota/not-a-number')
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 10, billing_cycle_day: 1 });
    expect(invalid.status).toBe(400);

    const resetMissing = await request(app)
      .post('/api/superadmin/autocomplete-quota/9999/reset-calls')
      .set('Cookie', adminCookies);
    expect(resetMissing.status).toBe(404);
  });

  it('rejects a report range longer than 30 days or with a bad date', async () => {
    setSuperAdminEnv(true);
    const app = await makeApp();
    const adminCookies = await loginAsSuperAdmin(app);

    const tooLong = await request(app)
      .get('/api/superadmin/autocomplete-quota/audit-log.csv?from=2026-01-01&to=2026-03-01')
      .set('Cookie', adminCookies);
    expect(tooLong.status).toBe(400);

    const badFormat = await request(app)
      .get('/api/superadmin/autocomplete-quota/audit-log.csv?from=nonsense&to=2026-01-01')
      .set('Cookie', adminCookies);
    expect(badFormat.status).toBe(400);

    const reversed = await request(app)
      .get('/api/superadmin/autocomplete-quota/audit-log.csv?from=2026-01-10&to=2026-01-01')
      .set('Cookie', adminCookies);
    expect(reversed.status).toBe(400);
  });

  it('denies the quota routes to a regular comercio admin', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda Normal');

    const res = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', comercioCookies);
    expect(res.status).toBe(403);
  });

  it('blocks autocomplete with 429 once the limit is reached', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda Bloqueada');
    setSuperAdminEnv(true);
    const adminCookies = await loginAsSuperAdmin(app);

    const listed = await request(app).get('/api/superadmin/autocomplete-quota').set('Cookie', adminCookies);
    const comercio = listed.body.data.find((row: any) => row.comercio_name === 'Tienda Bloqueada');
    const id = comercio.comercio_id;

    // A limit of 1 lets the first call through and blocks the next one.
    await request(app)
      .put(`/api/superadmin/autocomplete-quota/${id}`)
      .set('Cookie', adminCookies)
      .send({ monthly_limit: 1, billing_cycle_day: 1 });

    const product = {
      id: 'p1',
      status: 'pending',
      source_file: 'PrestaShop',
      validation_errors: [],
      warnings: [],
      brand: 'Nike',
      description: '',
      description_short: '',
      meta_title: '',
      meta_description: ''
    };

    const first = await request(app)
      .post('/api/autocomplete')
      .set('Cookie', comercioCookies)
      .send({ language: 'es', product: { ...product, reference: 'REF-1' } });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/autocomplete')
      .set('Cookie', comercioCookies)
      .send({ language: 'es', product: { ...product, reference: 'REF-2' } });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('autocomplete_quota_exceeded');
    expect(second.body.error.details.reason).toBe('exhausted');
  });

  it('blocks autocomplete with 429 when the comercio is disabled', async () => {
    setSuperAdminEnv(false);
    const app = await makeApp();
    const comercioCookies = await registerComercio(app, 'Tienda Deshabilitada');

    const res = await request(app)
      .post('/api/autocomplete')
      .set('Cookie', comercioCookies)
      .send({
        language: 'es',
        product: {
          id: 'p1',
          status: 'pending',
          source_file: 'PrestaShop',
          validation_errors: [],
          warnings: [],
          reference: 'REF-1',
          brand: 'Nike',
          description: '',
          description_short: '',
          meta_title: '',
          meta_description: ''
        }
      });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('autocomplete_quota_exceeded');
    expect(res.body.error.details.reason).toBe('disabled');
  });
});