import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';

function setup(endpoint: string, bound = true) {
  let handler = async (_req: Request): Promise<Response> => new Response(null, { status: 500 });
  const writes = vi.fn();
  const session = { access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 };
  const user = { id: 'test-user', email: 'test@example.test' };
  const client = {
    from: (table: string) => {
      const query: any = {
        select: () => query, eq: () => query, in: () => query,
        update: (data: unknown) => { writes(table, data); return query; },
        upsert: (data: unknown) => { writes(table, data); return query; },
        delete: () => query,
        maybeSingle: async () => ({ data: table === 'user_devices'
          ? (bound ? { id: 'device', user_id: user.id, is_active: true } : null)
          : { is_blocked: false, is_active: true }, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
      };
      return query;
    },
    auth: {
      signInWithPassword: async () => ({ data: { session, user }, error: null }),
      admin: {
        getUserById: async () => ({ data: { user }, error: null }),
        generateLink: async () => ({ data: { properties: { hashed_token: 'test-hash' } }, error: null }),
      },
      verifyOtp: async () => ({ data: { session, user }, error: null }),
    },
  };
  const source = readFileSync(`supabase/functions/${endpoint}/index.ts`, 'utf8').replace(/^import .*;$/m, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  new Function('Deno', 'createClient', js)(
    { env: { get: () => 'test-only' }, serve: (fn: typeof handler) => { handler = fn; } },
    () => client,
  );
  return { writes, invoke: (platform = 'tizen') => handler(new Request(`https://tv2.lntelecom.net/functions/v1/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: 'CA3E-XVGA-UJGU-R', platform, email: user.email, password: 'test-password' }),
  })) };
}
describe('Samsung device activation endpoints', () => {
  it('announces the normalized Samsung code for the admin to bind', async () => {
    const { invoke, writes } = setup('device-announce', false);
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(writes).toHaveBeenCalledWith('pending_devices', expect.objectContaining({ platform: 'tizen', device_id: 'CA3EXVGAUJGUR' }));
  });
  it('returns an account ID and expiry for Samsung automatic activation', async () => {
    const { invoke } = setup('device-auto-login');
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { id: 'test-user' }, user_id: 'test-user', expires_in: 3600 });
  });
  it('allows Samsung password login with an active binding', async () => {
    const { invoke } = setup('device-login');
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, user: { id: 'test-user' } });
  });
  it.each(['device-announce', 'device-auto-login', 'device-login'])('rejects unknown platforms in %s', async (endpoint) => {
    const { invoke } = setup(endpoint);
    expect((await invoke('unknown-platform')).status).toBe(400);
  });
});