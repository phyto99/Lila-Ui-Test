import * as licon from 'lib/licon';
import { initMiniBoards, initMiniGames, updateMiniGame, finishMiniGame } from 'lib/view/miniBoard';
import { text as xhrText } from 'lib/xhr';
import { display as announceDisplay } from './announce';
import OnlineFriends from './friends';
import powertip from './powertip';
import serviceWorker from './serviceWorker';
import { watchers } from 'lib/view/watchers';
import { isIos, isWebkit, prefersLightThemeQuery } from 'lib/device';
import { scrollToInnerSelector, requestIdleCallback } from 'lib';
import { dispatchChessgroundResize } from 'lib/chessgroundResize';
import { attachDomHandlers } from './domHandlers';
import { updateTimeAgo, renderTimeAgo } from './renderTimeAgo';
import { pubsub } from 'lib/pubsub';
import { once } from 'lib/storage';
import { toggleBoxInit } from 'lib/view/controls';
import { addExceptionListeners } from './unhandledError';
import { eventuallySetupDefaultConnection } from 'lib/socket';
import { alert } from 'lib/view/dialogs';

export function boot() {
  applyStoredAppearance();
  addExceptionListeners();
  $('#user_tag').removeAttr('href');
  const setBlind = location.hash === '#blind';
  const showDebug = location.hash.startsWith('#debug');

  requestAnimationFrame(() => {
    initMiniBoards();
    initMiniGames();
    pubsub.on('content-loaded', initMiniBoards);
    pubsub.on('content-loaded', initMiniGames);
    updateTimeAgo(1000);
    pubsub.on('content-loaded', renderTimeAgo);
    pubsub.on('content-loaded', toggleBoxInit);
  });
  requestIdleCallback(() => {
    const friendsEl = document.getElementById('friend_box');
    if (friendsEl) new OnlineFriends(friendsEl);

    const chatMembers = document.querySelector('.chat__members') as HTMLElement | null;
    if (chatMembers) watchers(chatMembers);

    $('.subnav__inner').each(function (this: HTMLElement) {
      scrollToInnerSelector(this, '.active', true);
    });

    powertip.watchMouse();

    attachDomHandlers();

    // prevent zoom when keyboard shows on iOS
    if (isIos() && !('MSStream' in window)) {
      const el = document.querySelector('meta[name=viewport]') as HTMLElement;
      el.setAttribute('content', el.getAttribute('content') + ',maximum-scale=1.0');
    }

    toggleBoxInit();

    window.addEventListener('resize', dispatchChessgroundResize);

    if (setBlind && !site.blindMode) setTimeout(() => $('#blind-mode button').trigger('click'), 1500);

    if (site.debug) site.asset.loadEsm('bits.devMode');
    if (showDebug) site.asset.loadEsm('bits.diagnosticDialog');

    serviceWorker();

    console.info('Lichess is open source! See https://lichess.org/source');

    // if not already connected by a ui module, setup default connection
    eventuallySetupDefaultConnection();

    if (isUnsupportedBrowser() && once('upgrade.nag', { days: 14 })) {
      pubsub
        .after('dialog.polyfill')
        .then(() => alert('Your browser is out of date.\nLichess may not work properly.'));
    }

    // socket default receive handlers
    pubsub.on('socket.in.redirect', (d: RedirectTo) => {
      site.unload.expected = true;
      site.redirect(d);
    });
    pubsub.on('socket.in.fen', e =>
      document.querySelectorAll('.mini-game-' + e.id).forEach((el: HTMLElement) => updateMiniGame(el, e)),
    );
    pubsub.on('socket.in.finish', e =>
      document.querySelectorAll('.mini-game-' + e.id).forEach((el: HTMLElement) => finishMiniGame(el, e.win)),
    );
    pubsub.on('socket.in.announce', announceDisplay);
    pubsub.on('socket.in.tournamentReminder', (data: { id: string; name: string }) => {
      if ($('#announce').length || document.body.dataset.tournamentId === data.id) return;
      const url = '/tournament/' + data.id;
      $('body').append(
        $('<div id="announce">')
          .append($(`<a data-icon="${licon.Trophy}" class="text">`).attr('href', url).text(data.name))
          .append(
            $('<div class="actions">')
              .append(
                $(`<a class="withdraw text" data-icon="${licon.Pause}">`)
                  .attr('href', url + '/withdraw')
                  .text(i18n.site.pause)
                  .on('click', function (this: HTMLAnchorElement) {
                    xhrText(this.href, { method: 'post' });
                    $('#announce').remove();
                    return false;
                  }),
              )
              .append(
                $(`<a class="text" data-icon="${licon.PlayTriangle}">`)
                  .attr('href', url)
                  .text(i18n.site.resume),
              ),
          ),
      );
    });
    const mql = prefersLightThemeQuery();
    if (typeof mql.addEventListener === 'function')
      mql.addEventListener('change', e => {
        if (document.body.dataset.theme === 'system')
          document.documentElement.className = e.matches ? 'light' : 'dark';
      });

    mirrorCheck();
  }, 800);
}

const isUnsupportedBrowser = () => isWebkit({ below: '15.4' });

function applyStoredAppearance() {
  const tint       = parseInt(localStorage.getItem('dasher.tint')       ?? '50');
  const brightness = parseInt(localStorage.getItem('dasher.brightness') ?? '33');

  const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
  const mkHsl = (h: number, s: number, l: number) =>
    `hsl(${Math.round(h)}, ${Math.round(Math.max(0, s))}%, ${Math.max(0, Math.min(100, l)).toFixed(1)}%)`;

  const t = tint / 100;
  const satScale = Math.abs(t - 0.5) * 2;
  const bgHue    = t < 0.5 ? 37 : 220;
  const bgSat    = 7 * satScale;
  const pageSat  = t < 0.5 ? lerp(10, 0, t * 2) : lerp(0, 9, (t - 0.5) * 2);
  const zebraSat = 5 * satScale;
  const bHue     = t < 0.5 ? 0 : 220;
  const bSat     = t < 0.5 ? 0 : lerp(0, 3, (t - 0.5) * 2);

  interface BStop { bgL: number; pageL: number; lowL: number; zebraL: number; zebra2L: number; borderL: number; borderPageL: number; }
  const lerpB = (a: BStop, b: BStop, u: number): BStop => ({
    bgL: lerp(a.bgL, b.bgL, u), pageL: lerp(a.pageL, b.pageL, u), lowL: lerp(a.lowL, b.lowL, u),
    zebraL: lerp(a.zebraL, b.zebraL, u), zebra2L: lerp(a.zebra2L, b.zebra2L, u),
    borderL: lerp(a.borderL, b.borderL, u), borderPageL: lerp(a.borderPageL, b.borderPageL, u),
  });
  const B_AMOLED: BStop = { bgL: 3,   pageL: 1,  lowL: 7,  zebraL: 4,    zebra2L: 6,  borderL: 14, borderPageL: 10 };
  const B_DARK:   BStop = { bgL: 14,  pageL: 8,  lowL: 22, zebraL: 19,   zebra2L: 24, borderL: 25, borderPageL: 22 };
  const B_ASH:    BStop = { bgL: 32,  pageL: 22, lowL: 40, zebraL: 30,   zebra2L: 36, borderL: 42, borderPageL: 38 };
  const B_LIGHT:  BStop = { bgL: 100, pageL: 92, lowL: 89, zebraL: 96.5, zebra2L: 92, borderL: 85, borderPageL: 80 };

  let bs: BStop;
  if (brightness <= 33)      bs = lerpB(B_AMOLED, B_DARK,  brightness / 33);
  else if (brightness <= 66) bs = lerpB(B_DARK,   B_ASH,   (brightness - 33) / 33);
  else                       bs = lerpB(B_ASH,    B_LIGHT,  (brightness - 66) / 34);

  const isLight  = brightness >= 66;
  const satFade  = isLight ? Math.max(0, 1 - (bs.bgL - 80) / 20) : 1;
  const eBgSat   = bgSat   * satFade;
  const ePageSat = pageSat * satFade;
  const eZSat    = zebraSat * satFade;

  const fontL     = isLight ? lerp(73, 30, (brightness - 75) / 25) : 73;
  const dimL      = isLight ? 47 : 58;
  const dimmerL   = isLight ? 70 : 42;
  const clearL    = isLight ? 12 : 80;
  const clearerL  = isLight ? 0  : 89;
  const fontPageL = isLight ? 37 : 58;
  const shadeL    = isLight ? 84 : 30;

  const H  = bgHue;
  const bH = bHue;
  const bS = bSat;
  const vars: Record<string, string> = {
    '--c-bg':                   mkHsl(H,  eBgSat,   bs.bgL),
    '--c-bg-box':               mkHsl(H,  eBgSat,   bs.bgL),
    '--c-bg-high':              mkHsl(H,  eBgSat,   bs.bgL),
    '--c-bg-opaque':            mkHsl(H,  eBgSat,   bs.bgL),
    '--c-bg-page':              mkHsl(H,  ePageSat, bs.pageL),
    '--c-bg-low':               mkHsl(H,  eBgSat,   bs.lowL),
    '--c-bg-popup':             mkHsl(H,  eBgSat,   bs.lowL),
    '--c-bg-header-dropdown':   mkHsl(H,  eBgSat,   bs.lowL),
    '--c-bg-zebra':             mkHsl(H,  eZSat,    bs.zebraL),
    '--c-bg-zebra2':            mkHsl(H,  eZSat,    bs.zebra2L),
    '--c-bg-input':             mkHsl(H,  ePageSat, isLight ? 98 : 13),
    '--c-bg-variation':         isLight
                                  ? mkHsl(H, eZSat, bs.zebra2L)
                                  : mkHsl(H, Math.round(eBgSat * 0.7), bs.bgL + 1),
    '--c-body-gradient':        mkHsl(H,  eBgSat + 2, bs.bgL + 2),
    '--c-metal-top':            mkHsl(H,  eBgSat,       bs.lowL),
    '--c-metal-bottom':         mkHsl(H,  eBgSat * 0.7, Math.max(0, bs.lowL - 3)),
    '--c-metal-top-hover':      mkHsl(H,  eBgSat,       bs.lowL + 3),
    '--c-metal-bottom-hover':   mkHsl(H,  eBgSat * 0.7, bs.lowL),
    '--c-border':               mkHsl(bH, bS,               bs.borderL),
    '--c-border-page':          mkHsl(bH, bS * 0.7,         bs.borderPageL),
    '--c-border-light':         mkHsl(bH, bS * 0.5,         isLight ? 80 : bs.bgL + 26),
    '--c-border-tour':          mkHsl(bH, bS * 0.5,         lerp(bs.borderPageL, bs.pageL, 0.5)),
    '--c-page-input':           mkHsl(H,  eBgSat,   isLight ? bs.lowL : bs.bgL),
    '--c-pool-button':          `hsla(${Math.round(H)}, ${Math.round(eBgSat)}%, ${bs.bgL.toFixed(1)}%, 0.66)`,
    '--c-font':                 `hsl(0, 0%, ${fontL.toFixed(1)}%)`,
    '--c-font-dim':             `hsl(0, 0%, ${dimL}%)`,
    '--c-font-dimmer':          `hsl(0, 0%, ${dimmerL}%)`,
    '--c-font-clear':           `hsl(0, 0%, ${clearL}%)`,
    '--c-font-clearer':         `hsl(0, 0%, ${clearerL}%)`,
    '--c-font-page':            `hsl(0, 0%, ${fontPageL}%)`,
    '--c-header-dropdown':      `hsl(0, 0%, ${fontL.toFixed(1)}%)`,
    '--c-shade':                `hsl(0, 0%, ${shadeL}%)`,
    '--c-dark':                 `hsl(0, 0%, ${isLight ? 80 : 20}%)`,
    '--c-dimmer':               isLight ? '#fff' : '#000',
    '--c-clearer':              isLight ? '#000' : '#fff',
    '--c-over':                 isLight ? '#000' : '#fff',
    '--c-page-mask':            isLight ? 'hsla(0, 0%, 100%, 0.5)' : 'hsla(0, 0%, 0%, 0.6)',
    '--c-font-shadow':          isLight ? '#fff' : 'hsla(0, 0%, 0%, 0)',
  };

  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  if (root.className !== 'transp') {
    root.className = isLight ? 'light' : 'dark';
    document.body.dataset.theme = isLight ? 'light' : 'dark';
  }
}

function mirrorCheck() {
  const mirrors: string[] = ['chess.shark-stars.com'];
  if (mirrors.includes(location.host)) location.href = 'https://lichess.org' + location.pathname;
}
