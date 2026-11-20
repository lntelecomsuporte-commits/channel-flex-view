import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

function load(name: string, app: Record<string, any>) {
  new Function('window', 'LNTV', readFileSync(`tizen/js/${name}.js`, 'utf8'))({ LNTV: app }, app);
}

function setup() {
  document.body.innerHTML = `
    <div id="screen-login">
      <div id="pair-code"></div>
      <div id="login-status"></div>
      <div id="dev-line"></div>
      <input id="login-user" type="text">
      <input id="login-pass" type="password">
      <button id="login-btn" type="button">Entrar</button>
      <div id="login-err"></div>
    </div>
    <div id="screen-player" class="hidden"></div>`;
  const app: Record<string, any> = {
    APP_VERSION: '1.0.2',
    device: { prettyId: () => 'TEST-DEVICE' },
    modal: { isOpen: () => false },
    auth: { manualLogin: vi.fn(async () => ({ ok: false, error: 'Credenciais inválidas' })) },
  };
  load('keys', app);
  load('app', app);
  app.app._startBeacon = vi.fn();
  app.app.showLogin();
  return app;
}

function press(app: Record<string, any>, keyCode: number) {
  const event = { keyCode, preventDefault: vi.fn() };
  app.app.onKey(event);
  return event;
}

describe('Samsung remote-control login', () => {
  it('focuses the user field and moves through user, password and Entrar with the remote', () => {
    const app = setup();
    expect(document.activeElement?.id).toBe('login-user');

    press(app, app.KEYS.DOWN);
    expect(document.activeElement?.id).toBe('login-pass');
    press(app, app.KEYS.DOWN);
    expect(document.activeElement?.id).toBe('login-btn');
    press(app, app.KEYS.DOWN);
    expect(document.activeElement?.id).toBe('login-btn');
    press(app, app.KEYS.UP);
    expect(document.activeElement?.id).toBe('login-pass');
    press(app, app.KEYS.UP);
    expect(document.activeElement?.id).toBe('login-user');
  });

  it('leaves OK untouched on inputs so Samsung can open its native keyboard', () => {
    const app = setup();
    app.app.doManualLogin = vi.fn();
    const event = press(app, app.KEYS.ENTER);

    expect(app.app.doManualLogin).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('login-user');
  });

  it('submits only when OK is pressed on Entrar', () => {
    const app = setup();
    app.app.doManualLogin = vi.fn();
    document.getElementById('login-btn')?.focus();
    const event = press(app, app.KEYS.ENTER);

    expect(app.app.doManualLogin).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('passes the typed credentials to the existing device login without changing pairing', async () => {
    const app = setup();
    (document.getElementById('login-user') as HTMLInputElement).value = 'support@example.test';
    (document.getElementById('login-pass') as HTMLInputElement).value = 'test-password';

    app.app.doManualLogin();
    await vi.waitFor(() => expect(document.getElementById('login-err')?.textContent).toBe('Credenciais inválidas'));

    expect(app.auth.manualLogin).toHaveBeenCalledWith('support@example.test', 'test-password');
    expect(app.app._startBeacon).toHaveBeenCalledOnce();
  });

  it('keeps the manifest and displayed app version at 1.0.2 with version code 2', () => {
    const xml = readFileSync('tizen/config.xml', 'utf8');
    const config = readFileSync('tizen/js/config.js', 'utf8');

    expect(xml).toContain('version="1.0.2"');
    expect(config).toContain('LNTV.APP_VERSION = "1.0.2";');
    expect(config).toContain('LNTV.APP_VERSION_CODE = 2;');
  });
});
