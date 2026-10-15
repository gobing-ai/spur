import figlet from 'figlet';
import standard from 'figlet/fonts/Standard';
import { CLI_CONFIG } from './config';

/**
 * Render the startup ASCII banner without runtime font file I/O. Its own module so figlet and the
 * font table load only when a banner is actually printed (PR-L, lazy CLI loading).
 */
export function bannerText(): string {
    figlet.parseFont('Standard', standard);
    return figlet.textSync(CLI_CONFIG.binaryLabel, { font: 'Standard' });
}
