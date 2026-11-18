import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';

function load(name: string, app: Record<string, any>) {
  new Function('window', 'LNTV', readFileSync(`tizen/js/${name}.js`, 'utf8'))({ LNTV: app }, app);
}
function setup() {
  document.body.innerHTML = '<div id="channel-lock" class="hidden"></div><video id="htmlplayer"></video>';
  const prompt = vi.fn();
  const app: Record<string, any> = {
    sb: { get: vi.fn(async () => [{ adult_pin: '2468' }]) },
    session: { userId: () => 'user-1' },
    modal: { prompt }, osd: { show: vi.fn() }, toast: { show: vi.fn(), hide: vi.fn() }, hb: { setChannel: vi.fn() },
  };
  load('channels', app); load('player', app);
  app.player.stop = vi.fn(); app.player._play = vi.fn();
  app.channels.list = [
    { id: 'open', channel_number: 1 },
    { id: 'adult', channel_number: 2, is_adult: true },
    { id: 'category', channel_number: 3, category_id: 'locked-cat' },
  ];
  app.channels.protectedCategories = { 'locked-cat': true };
  return { app, prompt };
}
afterEach(() => vi.useRealTimers());
describe('Samsung protected channels', () => {
  it('does not play adult channels or prompt during zapping', () => {
    const { app, prompt } = setup(); app.player.tuneByIndex(1);
    expect(app.player._play).not.toHaveBeenCalled(); expect(prompt).not.toHaveBeenCalled();
    expect(app.player._locked).toBe(true); expect(app.hb.setChannel).toHaveBeenCalledWith(null);
  });
  it('locks categories requiring a PIN', () => {
    const { app } = setup(); app.player.tuneByIndex(2);
    expect(app.player._locked).toBe(true); expect(app.player._play).not.toHaveBeenCalled();
  });
  it('allows channel up and down through locked channels', () => {
    vi.useFakeTimers();
    const { app } = setup(); app.player.tuneByIndex(1); app.player.step(1);
    expect(app.player.current.id).toBe('category'); app.player.step(1);
    expect(app.player.current.id).toBe('open'); expect(app.player._play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300); expect(app.player._play).toHaveBeenCalledTimes(1);
  });
  it('only accepts the account PIN after OK', async () => {
    const { app, prompt } = setup(); app.player.tuneByIndex(1); app.player.unlock();
    await Promise.resolve();
    const confirm = prompt.mock.calls[0][3]; confirm('0000');
    expect(app.player._play).not.toHaveBeenCalled(); confirm('2468');
    expect(app.player._locked).toBe(false); expect(app.player._play).toHaveBeenCalledTimes(1);
  });
  it('cancel leaves the selected channel locked', async () => {
    const { app } = setup();
    document.body.insertAdjacentHTML('beforeend', '<div id="modal" class="hidden"></div><div id="modal-title"></div><div id="modal-body"></div><button id="modal-cancel"></button>');
    load('menu', app); vi.useFakeTimers();
    app.player.tuneByIndex(1); app.player.unlock(); await Promise.resolve(); app.modal.cancel();
    expect(app.player.current.id).toBe('adult'); expect(app.player._locked).toBe(true);
    expect(app.player._play).not.toHaveBeenCalled();
  });
  it('fails closed if category protection cannot load', async () => {
    const { app } = setup(); app.sb.get.mockRejectedValue(new Error('offline'));
    await expect(app.channels.load()).rejects.toThrow('offline');
  });
});
describe('Samsung session presence', () => {
  it('retains the returned session ID and reads signout before playing', async () => {
    vi.useFakeTimers(); const fn = vi.fn(async () => new Response(JSON.stringify({ id: 'session-samsung' })));
    const app: Record<string, any> = {
      sb: { fn }, device: { id: () => 'SAMSUNG123', name: () => 'Samsung' }, PLATFORM: 'tizen',
      player: { stop: vi.fn() }, modal: { close: vi.fn() }, auth: { logout: vi.fn() }, app: { showLogin: vi.fn() },
    };
    load('heartbeat', app);
    expect(await app.hb.start()).toBe(true);
    expect(app.hb._payload('heartbeat').sessionId).toBe('session-samsung');
    await app.hb._read(new Response(JSON.stringify({ forceSignout: true, command: 'force_close' })));
    expect(app.auth.logout).toHaveBeenCalledOnce(); expect(app.player.stop).toHaveBeenCalledOnce();
    expect(app.app.showLogin).toHaveBeenCalledOnce(); expect(app.hb._id).toBeNull();
  });
});

describe('Samsung startup', () => {
  it('requests server-authorized active channels when no categories are assigned', async () => {
    const { app } = setup();
    app.sb.get.mockImplementation(async (path: string) => path.startsWith('channels?')
      ? [{ id: 'open', channel_number: 1 }, { id: 'adult', channel_number: 2, is_adult: true }]
      : []);
    const channels = await app.channels.load();
    expect(channels.map((ch: { id: string }) => ch.id)).toEqual(['open', 'adult']);
    const query = app.sb.get.mock.calls.find(([path]: [string]) => path.startsWith('channels?'))?.[0];
    expect(query).toContain('&is_active=eq.true&order=channel_number.asc');
    expect(query).not.toContain('category_id=in.');
    expect(app.channels.isRestricted(channels[1])).toBe(true);
    expect(app.sb.get).toHaveBeenCalledWith('user_category_access?select=category_id&user_id=eq.user-1&is_active=eq.true', true);
  });
  it('preserves direct and included category filters', async () => {
    const { app } = setup();
    app.sb.get.mockImplementation(async (path: string) => {
      if (path.startsWith('user_category_access?')) return [{ category_id: 'sports' }];
      if (path.startsWith('category_includes?')) return [{ included_category_id: 'open-tv' }];
      return [];
    });
    await app.channels.load();
    const query = app.sb.get.mock.calls.find(([path]: [string]) => path.startsWith('channels?'))?.[0];
    expect(query).toContain('&category_id=in.(sports,open-tv)');
  });
  it('keeps an empty lineup when the server returns no authorized channels', async () => {
    const { app } = setup(); app.sb.get.mockResolvedValue([]);
    expect(await app.channels.load()).toEqual([]);
    expect(app.channels.list).toEqual([]);
  });
  it('does not request channels without a signed-in user', async () => {
    const { app } = setup(); app.session.userId = () => null;
    await expect(app.channels.load()).rejects.toThrow('Sessão não autenticada');
    expect(app.sb.get).not.toHaveBeenCalled();
  });
  function startup(ok: boolean) {
    document.body.innerHTML = '<div id="screen-login"></div><div id="screen-player" class="hidden"></div>';
    const app: Record<string, any> = {
      channels: { load: vi.fn(async () => [{ id: 'open' }]) },
      hb: { start: vi.fn(async () => ok) }, player: { tuneByIndex: vi.fn() },
      toast: { show: vi.fn() }, update: { check: vi.fn() },
    };
    load('app', app);
    return app;
  }
  it('starts the first channel right after channels load, without waiting for the session check', async () => {
    vi.useFakeTimers(); const app = startup(true);
    app.hb.start = vi.fn(() => new Promise(() => {}));
    app.app.enterApp();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.player.tuneByIndex).toHaveBeenCalledWith(0);
  });
  it('keeps playing and warns when the session check fails', async () => {
    vi.useFakeTimers(); const app = startup(false); app.app.enterApp();
    await vi.advanceTimersByTimeAsync(0);
    expect(app.player.tuneByIndex).toHaveBeenCalledWith(0);
    expect(app.toast.show).toHaveBeenCalled();
  });
  it('declares the AVPlay and remote-control privileges Samsung requires', () => {
    const xml = readFileSync('tizen/config.xml', 'utf8');
    expect(xml).toContain('http://developer.samsung.com/privilege/avplay');
    expect(xml).toContain('http://tizen.org/privilege/tv.inputdevice');
    expect(xml).not.toContain('allow-navigation');
  });
  it('propagates channel request failures instead of treating them as an empty lineup', async () => {
    const { app } = setup();
    app.sb.get.mockImplementation(async (path: string, strict: boolean) => {
      if (path.startsWith('categories?')) return [];
      if (path.startsWith('user_category_access?')) return [{ category_id: 'cat' }];
      if (path.startsWith('category_includes?')) return [];
      if (strict) throw new Error('channels-offline');
      return [];
    });
    await expect(app.channels.load()).rejects.toThrow('channels-offline');
  });
});

describe('Samsung playback recovery', () => {
  it('does not preview a nonexistent channel in an empty lineup', () => {
    const { app } = setup(); app.channels.list = [];
    app.player.preview(1);
    expect(app.osd.show).not.toHaveBeenCalled();
    expect(app.player._previewIdx).toBe(-1);
  });
  it('retries playback errors and cancels the retry once playing', async () => {
    vi.useFakeTimers(); const { app } = setup();
    app.player._onError();
    expect(app.player._statsCache.state).toBe('error');
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.player._play).toHaveBeenCalledOnce();
    app.player._onError(); app.player._onPlaying();
    await vi.advanceTimersByTimeAsync(10000);
    expect(app.player._play).toHaveBeenCalledOnce();
    expect(app.player._statsCache.state).toBe('playing');
  });
  it('does not play removed channels after an empty remote reload', async () => {
    vi.useFakeTimers(); const { app } = setup();
    app.device = { id: () => 'Samsung', name: () => 'Samsung' };
    app.channels.load = vi.fn(async () => []);
    app.sb.fn = vi.fn(async () => new Response('{}'));
    app.player.tuneByIndex = vi.fn(); load('heartbeat', app); app.hb._token = 'test-token';
    await app.hb._read(new Response(JSON.stringify({ command: 'reload_channels' })));
    await vi.advanceTimersByTimeAsync(0);
    expect(app.player.stop).toHaveBeenCalled();
    expect(app.player.tuneByIndex).not.toHaveBeenCalled();
    expect(app.hb._watching).toBe(false);
  });
});
