import { h, type VNode } from 'snabbdom';
import { elementScrollBarWidthSlowGuess, header } from './util';
import { debounce, throttlePromiseDelay } from 'lib/async';
import { prefersLightThemeQuery } from 'lib/device';
import * as licon from 'lib/licon';
import { bind, hl } from 'lib/snabbdom';
import { text as xhrText, form as xhrForm, textRaw as xhrTextRaw } from 'lib/xhr';
import { type DasherCtrl, PaneCtrl } from './interfaces';
import { pubsub } from 'lib/pubsub';

export interface BackgroundData {
  current: string;
  image: string;
  gallery?: {
    images: string[];
    montage2: string;
    montage4: string;
  };
}

interface Background {
  key: string;
  name: string;
  title?: string;
}

// ─── Appearance (tint + brightness) ───────────────────────────────────────────

// brightness stops — lightness values lifted directly from _theme.default.scss / _theme.light.scss
interface BStop {
  bgL: number; pageL: number; lowL: number;
  zebraL: number; zebra2L: number;
  borderL: number; borderPageL: number;
}
// amoled: near-black
const B_AMOLED: BStop = { bgL: 3,   pageL: 1,  lowL: 7,  zebraL: 4,    zebra2L: 6,  borderL: 14, borderPageL: 10 };
// dark: exact Lichess defaults (hsl(37,7%,14) bg, hsl(37,10%,8) page, hsl(0,0%,25) border)
const B_DARK:   BStop = { bgL: 14,  pageL: 8,  lowL: 22, zebraL: 19,   zebra2L: 24, borderL: 25, borderPageL: 22 };
// ash: medium-grey lift (+18 on bg roughly)
const B_ASH:    BStop = { bgL: 32,  pageL: 22, lowL: 40, zebraL: 30,   zebra2L: 36, borderL: 42, borderPageL: 38 };
// light: from _theme.light.scss
const B_LIGHT:  BStop = { bgL: 100, pageL: 92, lowL: 89, zebraL: 96.5, zebra2L: 92, borderL: 85, borderPageL: 80 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function lerpBStop(a: BStop, b: BStop, t: number): BStop {
  const l = (av: number, bv: number) => lerp(av, bv, t);
  return {
    bgL: l(a.bgL, b.bgL), pageL: l(a.pageL, b.pageL), lowL: l(a.lowL, b.lowL),
    zebraL: l(a.zebraL, b.zebraL), zebra2L: l(a.zebra2L, b.zebra2L),
    borderL: l(a.borderL, b.borderL), borderPageL: l(a.borderPageL, b.borderPageL),
  };
}

function mkHsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(Math.max(0, s))}%, ${Math.max(0, Math.min(100, l)).toFixed(1)}%)`;
}

/**
 * Computes CSS custom property overrides for the tint + brightness system.
 *  tint=0   → Lichess (hue 37, warm brown-black) — matches compiled SCSS exactly
 *  tint=100 → Discord  (hue 220, cool blue-black)
 *  brightness=0/33/66/100 → amoled / dark / ash / light
 */
export function computeAppearanceVars(tint: number, brightness: number): Record<string, string> {
  const t = tint / 100;

  // tint axis: hue goes Lichess(37) → Pure(any, sat=0) → Discord(220)
  // Saturation forms a V-shape: full at both ends, zero at tint=50 (Pure = monochrome)
  const satScale  = Math.abs(t - 0.5) * 2;   // 1 at tint=0/100, 0 at tint=50
  const bgHue     = t < 0.5 ? 37 : 220;      // doesn't matter at sat=0, but avoids mid-hue artifacts
  const bgSat     = 7   * satScale;
  const pageSat   = (t < 0.5 ? lerp(10, 0, t * 2) : lerp(0, 9, (t - 0.5) * 2));
  const zebraSat  = 5   * satScale;
  const borderHue = t < 0.5 ? 0 : 220;
  const borderSat = (t < 0.5 ? lerp(0, 0, t * 2) : lerp(0, 3, (t - 0.5) * 2));

  // brightness axis: interpolate between the four named stops
  let bs: BStop;
  if (brightness <= 33)      bs = lerpBStop(B_AMOLED, B_DARK,  brightness / 33);
  else if (brightness <= 66) bs = lerpBStop(B_DARK,   B_ASH,   (brightness - 33) / 33);
  else                       bs = lerpBStop(B_ASH,    B_LIGHT,  (brightness - 66) / 34);

  const isLight = brightness >= 75;

  // Saturation fades naturally as backgrounds approach pure white
  const satFade   = isLight ? Math.max(0, 1 - (bs.bgL - 80) / 20) : 1;
  const eBgSat    = bgSat   * satFade;
  const ePageSat  = pageSat * satFade;
  const eZebraSat = zebraSat * satFade;

  // font & chrome lightness values mirror the SCSS theme definitions exactly
  const fontL     = isLight ? lerp(73, 30, (brightness - 75) / 25) : 73;
  const dimL      = isLight ? 47 : 58;
  const dimmerL   = isLight ? 70 : 42;
  const clearL    = isLight ? 12 : 80;
  const clearerL  = isLight ? 0  : 89;
  const fontPageL = isLight ? 37 : 58;
  const shadeL    = isLight ? 84 : 30;

  const H  = bgHue;
  const bH = borderHue;
  const bS = borderSat;

  return {
    '--c-bg':                   mkHsl(H,  eBgSat,   bs.bgL),
    '--c-bg-box':               mkHsl(H,  eBgSat,   bs.bgL),
    '--c-bg-high':              mkHsl(H,  eBgSat,   bs.bgL),
    '--c-bg-opaque':            mkHsl(H,  eBgSat,   bs.bgL),
    '--c-bg-page':              mkHsl(H,  ePageSat, bs.pageL),
    '--c-bg-low':               mkHsl(H,  eBgSat,   bs.lowL),
    '--c-bg-popup':             mkHsl(H,  eBgSat,   bs.lowL),
    '--c-bg-header-dropdown':   mkHsl(H,  eBgSat,   bs.lowL),
    '--c-bg-zebra':             mkHsl(H,  eZebraSat, bs.zebraL),
    '--c-bg-zebra2':            mkHsl(H,  eZebraSat, bs.zebra2L),
    '--c-bg-input':             mkHsl(H,  ePageSat, isLight ? 98 : 13),
    '--c-bg-variation':         isLight
                                  ? mkHsl(H, eZebraSat, bs.zebra2L)
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
}

// ──────────────────────────────────────────────────────────────────────────────

export class BackgroundCtrl extends PaneCtrl {
  private list: Background[];
  private tint: number;
  private brightness: number;

  constructor(root: DasherCtrl) {
    super(root);
    this.list = [
      { key: 'system', name: i18n.site.deviceTheme },
      { key: 'light', name: i18n.site.light },
      { key: 'dark', name: i18n.site.dark },
      { key: 'transp', name: 'Picture' },
    ];
    this.tint       = parseInt(localStorage.getItem('dasher.tint')       ?? '50');
    this.brightness = parseInt(localStorage.getItem('dasher.brightness') ?? '33');
    this.applyAppearance();
  }

  render(): VNode {
    const cur = this.get();
    return h('div.sub.background', [
      header(i18n.site.background, this.close),
      h(
        'div.selector.large',
        this.list.map(bg =>
          h(
            'button.text',
            {
              class: { active: cur === bg.key },
              attrs: { 'data-icon': licon.Checkmark, title: bg.title || '', type: 'button' },
              hook: bind('click', () => this.set(bg.key)),
            },
            bg.name,
          ),
        ),
      ),
      this.appearanceSection(),
      cur !== 'transp' ? null : this.data.gallery ? this.galleryInput() : this.imageInput(),
    ]);
  }

  set: (c: string) => Promise<void> = throttlePromiseDelay(
    () => 700,
    (c: string) => {
      this.data.current = c;
      this.apply();
      this.redraw();
      return xhrText('/pref/bg', { body: xhrForm({ bg: c }), method: 'post' }).then(
        this.reloadAllTheThings,
        this.announceFail,
      );
    },
  );

  private get data() {
    return this.root.data.background;
  }

  private announceFail = (err: string) =>
    site.announce({ msg: `Failed to save background preference: ${err}` });

  private reloadAllTheThings = () => {
    if ($('canvas').length) site.reload();
  };

  private get = () => this.data.current;
  private getImage = () => this.data.image;
  private setImage = (i: string) => {
    this.data.image = i.startsWith('/assets/') ? i.slice(8) : i;
    xhrTextRaw('/pref/bgImg', { body: xhrForm({ bgImg: i }), method: 'post' })
      .then(res => (res.ok ? res.text() : Promise.reject(res.text())))
      .then(this.reloadAllTheThings, err => err.then(this.announceFail));
    this.apply();
    this.redraw();
  };

  private apply = () => {
    const key = this.data.current;
    document.body.dataset.theme = key === 'darkBoard' ? 'dark' : key;
    document.documentElement.className =
      key === 'system' ? (prefersLightThemeQuery().matches ? 'light' : 'dark') : key;

    if (key === 'transp') {
      const bgData = document.getElementById('bg-data');
      bgData
        ? (bgData.innerHTML = 'html.transp::before{background-image:url(' + this.data.image + ');}')
        : $('head').append(
            '<style id="bg-data">html.transp::before{background-image:url(' + this.data.image + ');}</style>',
          );
    }
    // Re-apply our CSS var overrides on top of the new theme class
    this.applyAppearance();
    pubsub.emit('theme', key);
  };

  // ─── Appearance system ───────────────────────────────────────────────────

  private applyAppearance = () => {
    const vars = computeAppearanceVars(this.tint, this.brightness);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

    // Keep the html class in sync with brightness so class-gated CSS rules
    // (e.g. html.light .foo { … }) also flip correctly, unless transp is active.
    const cur = this.data?.current;
    if (cur !== 'transp') {
      const wantsLight = this.brightness >= 66;
      root.className   = wantsLight ? 'light' : 'dark';
      document.body.dataset.theme = wantsLight ? 'light' : 'dark';
    }

    localStorage.setItem('dasher.tint',       this.tint.toString());
    localStorage.setItem('dasher.brightness', this.brightness.toString());
  };

  private setTint = (v: number) => {
    this.tint = v;
    this.applyAppearance();
    this.redraw();
  };

  private setBrightness = (v: number) => {
    this.brightness = v;
    this.applyAppearance();
    this.redraw();
  };

  private appearanceSection = (): VNode => {
    const vars = computeAppearanceVars(this.tint, this.brightness);
    const swatches = ['--c-bg', '--c-bg-low', '--c-bg-popup', '--c-border'].map(k =>
      hl('div.swatch', { attrs: { style: `background:${vars[k]}`, title: k } }),
    );
    // show the fixed accent colour from live computed style
    const accentColor =
      getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() ||
      'hsl(22, 100%, 42%)';
    swatches.push(hl('div.swatch.swatch-accent', { attrs: { style: `background:${accentColor}`, title: '--c-accent' } }));

    return hl('div.appearance', [
      hl('div.appearance-divider'),
      this.appSlider(
        'tint', 'Tint', this.tint, 0, 100, 1,
        ['Lichess', 'Pure', 'Discord'], [0, 50, 100],
        this.setTint,
      ),
      this.appSlider(
        'brightness', 'Brightness', this.brightness, 0, 100, 1,
        ['⬛', '☾ Dark', '◑ Ash', '☀'],  [0, 33, 66, 100],
        this.setBrightness,
      ),
      hl('div.color-swatches', swatches),
    ]);
  };

  private appSlider = (
    key: string,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    stopLabels: string[],
    stopValues: number[],
    onChange: (v: number) => void,
  ): VNode =>
    hl(`div.app-slider.${key}`, [
      hl('label', label),
      hl('input.range', {
        attrs: { type: 'range', min, max, step, value },
        hook: {
          insert: (vnode: VNode) => {
            const el = vnode.elm as HTMLInputElement;
            el.addEventListener('input', () => onChange(parseInt(el.value)));
          },
        },
      }),
      hl(
        'div.stop-labels',
        stopValues.map((sv, i) =>
          hl('button.stop-label', {
            attrs: { type: 'button', style: `left:${(sv / max) * 100}%` },
            hook: bind('click', () => onChange(sv)),
          }, stopLabels[i]),
        ),
      ),
    ]);

  // ─── Gallery / image input ───────────────────────────────────────────────

  private imageInput = () =>
    h('div.image', [
      h('label', { attrs: { for: 'backgroundUrl' } }, i18n.site.backgroundImageUrl),
      h('input#backgroundUrl', {
        attrs: { type: 'text', placeholder: 'https://', value: this.getImage() },
        hook: {
          insert: vnode => {
            const el = vnode.elm as HTMLInputElement;
            $(el).on(
              'change keyup paste',
              debounce(_ => {
                const url = el.value.trim();
                if (
                  (url.startsWith('https://') || url.startsWith('//')) &&
                  url.length >= 10 &&
                  url.length <= 400
                )
                  this.setImage(url);
              }, 300),
            );
          },
        },
      }),
    ]);

  private galleryInput = () => {
    const urlId = (url: string) => url.replace(/[^\w]/g, '_');

    const setImg = (url: string) => {
      $('#images-grid .selected').removeClass('selected');
      $(`#${urlId(url)}`).addClass('selected');
      this.setImage(url);
    };

    const gallery = this.data.gallery!;
    const cols = window.matchMedia('(min-width: 650px)').matches ? 4 : 2;
    const montageUrl = site.asset.url(gallery[`montage${cols}`]);
    const width =
      cols * (160 + 2) + (gallery.images.length > cols * 4 ? elementScrollBarWidthSlowGuess() : 0);

    return h('div#gallery', { attrs: { style: `width: ${width}px` } }, [
      h('div#images-viewport', [
        h(
          'div#images-grid',
          { attrs: { style: `background-image: url(${montageUrl});` } },
          gallery.images.map(img => {
            const assetUrl = site.asset.url(img);
            const divClass = this.data.image.endsWith(assetUrl) ? '.selected' : '';
            return h(`div#${urlId(assetUrl)}${divClass}`, { hook: bind('click', () => setImg(assetUrl)) });
          }),
        ),
      ]),
      this.imageInput(),
    ]);
  };
}