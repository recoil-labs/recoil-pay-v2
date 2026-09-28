import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

const require = createRequire(import.meta.url);

// The fontsource packages only export their CSS, so resolve that and walk
// to the sibling files/ directory. satori reads WOFF but not WOFF2.
const fontFile = (pkg: string, file: string) => readFileSync(join(dirname(require.resolve(pkg)), 'files', file));

const fonts = [
  { name: 'Inter', data: fontFile('@fontsource/inter', 'inter-latin-400-normal.woff'), weight: 400 as const, style: 'normal' as const },
  { name: 'Inter', data: fontFile('@fontsource/inter', 'inter-latin-500-normal.woff'), weight: 500 as const, style: 'normal' as const },
  {
    name: 'JetBrains Mono',
    data: fontFile('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff'),
    weight: 400 as const,
    style: 'normal' as const,
  },
];

const LOGO = `data:image/png;base64,${readFileSync(new URL('../logo.png', import.meta.url)).toString('base64')}`;

const C = { ground: '#161826', ink: '#e9e9ed', secondary: '#b4b5c4', muted: '#8b8c9c', accent: '#9184d9', hairline: '#2a2c3d' };

type Node = { type: string; props: Record<string, unknown> & { children?: unknown } };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

/** Shrink long tags so @abcdefghijklmnopqrst still fits on one line. */
const tagSize = (tag: string) => (tag.length <= 8 ? 148 : tag.length <= 12 ? 120 : tag.length <= 16 ? 96 : 80);

/**
 * The card that appears when someone posts their tag. Deliberately the same
 * as the page: flat ground, hairlines, Inter at the heading weight, no glow.
 * Inter is set at 400 here because 450 isn't available as a static face.
 */
export async function renderOg(tag: string | null, reservedAt?: string): Promise<Buffer> {
  const header = h('div', { display: 'flex', alignItems: 'center', gap: 16 }, [
    h('img', { width: 44, height: 44, borderRadius: 10 }, undefined, { src: LOGO, width: 44, height: 44 }),
    h('div', { display: 'flex', fontSize: 34, color: C.ink, fontWeight: 500, letterSpacing: '-0.01em' }, [
      'Recoil',
      h('span', { color: C.accent }, 'Pay'),
    ]),
    h('div', { fontFamily: 'JetBrains Mono', fontSize: 20, color: C.muted, marginLeft: 4, marginTop: 6 }, 'tags'),
  ]);

  const body = tag
    ? h('div', { display: 'flex', flexDirection: 'column', gap: 28 }, [
        h('div', { fontFamily: 'JetBrains Mono', fontSize: 24, color: C.accent }, '/reserved'),
        h('div', { fontSize: tagSize(tag), color: C.ink, letterSpacing: '-0.03em', lineHeight: 1 }, `@${tag}`),
      ])
    : h('div', { display: 'flex', flexDirection: 'column', gap: 28 }, [
        h('div', { fontFamily: 'JetBrains Mono', fontSize: 24, color: C.accent }, '/reserve'),
        h('div', { fontSize: 88, color: C.ink, letterSpacing: '-0.03em', lineHeight: 1.04, maxWidth: 900 }, 'Your wallet, but it has a name.'),
      ]);

  const footer = h('div', { display: 'flex', flexDirection: 'column', gap: 24 }, [
    h('div', { width: '100%', height: 1, backgroundColor: C.hairline }),
    h('div', { display: 'flex', justifyContent: 'space-between', fontFamily: 'JetBrains Mono', fontSize: 22, color: C.muted }, [
      h('div', {}, tag ? 'reserved on RecoilPay' : 'tags.recoilpay.com'),
      h('div', {}, reservedAt ? new Date(reservedAt).toISOString().slice(0, 10) : ''),
    ]),
  ]);

  const svg = await satori(
    h(
      'div',
      {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px 56px',
        backgroundColor: C.ground,
        fontFamily: 'Inter',
      },
      [header, body, footer],
    ) as never,
    { width: 1200, height: 630, fonts },
  );
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
