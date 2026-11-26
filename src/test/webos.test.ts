import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';

function load(name: string, app: Record<string, any>, extra: Record<string, unknown> = {}) {
  const names = ['window', 'LNTV', ...Object.keys(extra)];
  new Function(...names, readFileSync(`webos/js/${name}.js`, 'utf8'))({ LNTV: app, crypto: globalThis.crypto }, app, ...Object.values(extra));
}

const html = readFileSync('webos/index.html', 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<!-- Modules'));

function press(app: Record<string, any>, keyCode: number) {
  const event = { keyCode, preventDefault: vi.fn() };
  app.app.onKey(event);
  return event;
}

function baseApp(overrides: Record<string, any> = {}) {
  document.body.innerHTML = body;
  localStorage.clear();
  localStorage.setItem('lntv.user_id', 'user-1');
  const app: Record<string, any> = {
    APP_VERSION: '1.0.1',
    FN_URL: 'https://tv2.lntelecom.net/functions/v1',
    auth: { manualLogin: vi.fn(async () => ({ ok: false, error: 'Credenciais inválidas' })), logout: vi.fn() },
    hb: { setChannel: vi.fn(), start: vi.fn(async () => true), stop: vi.fn() },
    osd: { show: vi.fn(), hide: vi.fn() },
    toast: { show: vi.fn(), hide: vi.fn() },
    list: { isOpen: () => false, close: vi.fn(), open: vi.fn() },
    numBuf: { hasPending: () => false, push: vi.fn() },
    stats: { _on: false },
    ...overrides,
  };
  load('keys', app);
  load('storage', app);
  load('device', app);
  load('menu', app);
  load('player', app);
  load('app', app);
  return app;
}

describe('LG webOS remote-control login', () => {
  it('moves through user, password and Entrar with the arrows and submits only from Entrar', async () => {
    const app = baseApp();
    app.app._startBeacon = vi.fn();
    app.app.showLogin();
    expect(document.activeElement?.id).toBe('login-user');
    (document.getElementById('login-user') as HTMLInputElement).value = '12345678901';
    (document.getElementById('login-pass') as HTMLInputElement).value = 'segredo';

    press(app, app.KEYS.DOWN);
    expect(document.activeElement?.id).toBe('login-pass');
    press(app, app.KEYS.ENTER); // Enter do teclado virtual na senha vai para o botão
    expect(document.activeElement?.id).toBe('login-btn');
    expect(app.auth.manualLogin).not.toHaveBeenCalled();

    press(app, app.KEYS.ENTER);
    expect(app.auth.manualLogin).toHaveBeenCalledWith('12345678901', 'segredo');
    await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById('login-err')?.textContent).toBe('Credenciais inválidas');
  });

  it('keeps OK on an empty field native so the LG keyboard can open', () => {
    const app = baseApp();
    app.app._startBeacon = vi.fn();
    app.app.showLogin();
    const event = press(app, app.KEYS.ENTER);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('login-user');
  });

  it('asks before closing when BACK (461) is pressed on the login screen', () => {
    const app = baseApp();
    app.app._startBeacon = vi.fn();
    app.app.showLogin();
    app.app.exit = vi.fn();
    press(app, 461);
    expect(app.modal.isOpen()).toBe(true);
    expect(document.getElementById('modal-title')?.textContent).toBe('Sair do LN TV');
    press(app, 461);
    expect(app.modal.isOpen()).toBe(false);
    expect(app.app.exit).not.toHaveBeenCalled();
  });
});

describe('LG webOS restricted (adult) channels', () => {
  const channels = [
    { id: 'free', name: 'Livre', channel_number: 1, stream_url: 'https://cdn.test/free.m3u8', is_adult: false, category_id: 'c1' },
    { id: 'adult', name: 'Adulto', channel_number: 2, stream_url: 'https://cdn.test/adult.m3u8', is_adult: true, category_id: 'c1' },
    { id: 'pin-cat', name: 'Categoria PIN', channel_number: 3, stream_url: 'https://cdn.test/pin.m3u8', is_adult: false, category_id: 'locked' },
  ];

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  function setup() {
    const app = baseApp({
      channels: {
        list: channels,
        protectedCategories: { locked: true },
        isRestricted(ch: any) { return !!(ch && (ch.is_adult || this.protectedCategories[ch.category_id])); },
        findByNumber: (n: number) => channels.findIndex((c) => c.channel_number === n),
      },
      sb: { get: vi.fn(async () => [{ adult_pin: '4321' }]) },
    });
    document.getElementById('screen-login')!.classList.add('hidden');
    document.getElementById('screen-player')!.classList.remove('hidden');
    return app;
  }
  const video = () => document.getElementById('htmlplayer') as HTMLVideoElement;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('shows the lock without loading the stream and without reporting the channel as watched', () => {
    const app = setup();
    app.player.tuneByIndex(1);
    expect(document.getElementById('channel-lock')!.classList.contains('hidden')).toBe(false);
    expect(video().getAttribute('src')).toBeNull();
    expect(app.hb.setChannel).toHaveBeenLastCalledWith(null);
  });

  it('locks channels whose category requires a PIN', () => {
    const app = setup();
    app.player.tuneByIndex(2);
    expect(app.player._locked).toBe(true);
  });

  it('lets the user zap away from a locked channel without asking for the PIN', () => {
    const app = setup();
    app.player.tuneByIndex(1);
    app.player.step(+1);
    expect(app.player.index).toBe(2);
    expect(app.modal.isOpen()).toBe(false);
  });

  it('opens the PIN prompt only on OK and keeps the channel locked after a wrong PIN', async () => {
    const app = setup();
    app.player.tuneByIndex(1);
    expect(app.modal.isOpen()).toBe(false);
    press(app, app.KEYS.ENTER);
    await flush();
    expect(app.modal.isOpen()).toBe(true);
    for (const d of [1, 1, 1, 1]) press(app, app.KEYS.N0 + d);
    expect(app.modal.isOpen()).toBe(false);
    expect(app.player._locked).toBe(true);
    expect(app.toast.show).toHaveBeenCalledWith('PIN incorreto');
  });

  it('cancelling the PIN prompt stays on the locked channel', async () => {
    const app = setup();
    app.player.tuneByIndex(1);
    press(app, app.KEYS.ENTER);
    await flush();
    press(app, 461);
    expect(app.modal.isOpen()).toBe(false);
    expect(app.player.index).toBe(1);
    expect(app.player._locked).toBe(true);
  });

  it('unlocks and plays after the correct 4-digit PIN typed on the remote', async () => {
    const app = setup();
    app.player.tuneByIndex(1);
    press(app, app.KEYS.ENTER);
    await flush();
    for (const d of [4, 3, 2, 1]) press(app, app.KEYS.N0 + d);
    expect(app.player._locked).toBe(false);
    expect(video().getAttribute('src')).toBe('https://cdn.test/adult.m3u8');
    expect(app.hb.setChannel).toHaveBeenLastCalledWith(channels[1]);
  });
});

describe('LG webOS device code', () => {
  it('uses the first 16 characters of the LGUDID so the code shown on the TV is the full ID', async () => {
    document.body.innerHTML = '';
    localStorage.clear();
    const app: Record<string, any> = {};
    class Bridge {
      onservicecallback: (msg: string) => void = () => {};
      call(uri: string) {
        expect(uri).toBe('luna://com.webos.service.sm/deviceid/getIDs');
        this.onservicecallback(JSON.stringify({ idList: [{ idType: 'LGUDID', idValue: 'a1b2c3d4-e5f6-7788-99aa-bbccddeeff00' }] }));
      }
    }
    load('storage', app);
    load('device', app, { PalmServiceBridge: Bridge });
    await expect(app.device.init()).resolves.toBe('A1B2C3D4E5F67788');
    expect(app.device.prettyId()).toBe('A1B2-C3D4-E5F6-7788');
  });

  it('reports platform webos and version 1.0.1', () => {
    const app: Record<string, any> = {};
    load('config', app);
    expect(app.PLATFORM).toBe('webos');
    expect(app.APP_VERSION).toBe('1.0.1');
    expect(app.APP_VERSION_CODE).toBe(2);
    expect(JSON.parse(readFileSync('webos/appinfo.json', 'utf8'))).toMatchObject({
      version: '1.0.1',
      disableBackHistoryAPI: true,
      handlesRelaunch: false,
      iconColor: '#ffffff',
    });
  });
});

describe('LG webOS launcher relaunch', () => {
  it('resumes playback and presence when the app icon raises webOSRelaunch', () => {
    const app = baseApp();
    app.registerKeys = vi.fn();
    app.device = { init: vi.fn(() => new Promise(() => {})) };
    app.app._bindClicks = vi.fn();
    app.app.resume = vi.fn();
    app.app.init();
    app.app._paused = true;

    document.dispatchEvent(new Event('webOSRelaunch'));

    expect(app.app.resume).toHaveBeenCalledTimes(1);
  });
});
