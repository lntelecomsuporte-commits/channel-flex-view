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
    modal: { prompt }, osd: { show: vi.fn() }, toast: { show: vi.fn() }, hb: { setChannel: vi.fn() },
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
    const { app } = setup(); app.player.tuneByIndex(1); app.player.step(1);
    expect(app.player.current.id).toBe('category'); app.player.step(1);
    expect(app.player.current.id).toBe('open'); expect(app.player._play).toHaveBeenCalledTimes(1);
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
