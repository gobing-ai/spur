/** PR-L lazy CLI loading — the banner lives in its own lazily imported module. */

import { expect, test } from 'bun:test';
import { bannerText } from '../src/banner';

test('bannerText renders the figlet "spur" banner without font file I/O', () => {
    const text = bannerText();
    expect(text).toContain('___');
    expect(text.split('\n').length).toBeGreaterThan(3);
    expect(bannerText()).toBe(text);
});
