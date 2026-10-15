import { describe, expect, test } from 'bun:test';
import { parseDogfoodGateArgs, runDogfoodGateCli } from '../../../src/services/dogfood/gate-cli';

/** `spur agent dogfood gate` argv contract (script-absorption PR-7; formerly detect-pipeline-driving). */
describe('dogfood gate CLI', () => {
    test('parseDogfoodGateArgs — flags, positional, -- remainder, empty steps', () => {
        expect(parseDogfoodGateArgs(['--help']).help).toBe(true);
        expect(parseDogfoodGateArgs(['-h']).help).toBe(true);
        expect(parseDogfoodGateArgs(['--testee', '/sp:dev-run 1', '--max-retry-present', '--json'])).toEqual({
            testee: '/sp:dev-run 1',
            maxRetryPresent: true,
            steps: [],
            json: true,
            help: false,
        });
        expect(parseDogfoodGateArgs(['/sp:dev-verify 1']).testee).toBe('/sp:dev-verify 1');
        expect(parseDogfoodGateArgs(['--', 'a', 'b', 'c']).testee).toBe('a b c');
        expect(parseDogfoodGateArgs(['--steps', 's1||s2||']).steps).toEqual(['s1', 's2']);
        expect(parseDogfoodGateArgs(['--steps', '']).steps).toEqual([]);
        expect(parseDogfoodGateArgs(['--testee']).testee).toBeNull();
    });

    test('runDogfoodGateCli — refuse / advisory / help / usage / clean proceed', () => {
        const refuse = runDogfoodGateCli(['--testee', '/sp:dev-run 0125 --auto']);
        expect(refuse.exitCode).toBe(2);
        expect(refuse.stdout).toContain('pipeline-driving testee detected');

        const advisory = runDogfoodGateCli([
            '--testee',
            '/sp:dev-run 0125 --next',
            '--max-retry-present',
            '--steps',
            'implement||verify',
            '--json',
        ]);
        expect(advisory.exitCode).toBe(0);
        const parsed = JSON.parse(advisory.stdout);
        expect(parsed.advisory).toBe(true);
        expect(parsed.refuse).toBe(false);

        const help = runDogfoodGateCli(['--help']);
        expect(help.exitCode).toBe(0);
        expect(help.stderr).toContain('Usage:');

        const usage = runDogfoodGateCli([]);
        expect(usage.exitCode).toBe(1);
        expect(usage.stderr).toContain('Usage:');

        const clean = runDogfoodGateCli([
            '--testee',
            '/sp:dev-verify 0277 --next',
            '--max-retry-present',
            '--steps',
            'load||verify',
        ]);
        expect(clean.exitCode).toBe(0);
        expect(clean.stdout).toBe('');
    });
});
