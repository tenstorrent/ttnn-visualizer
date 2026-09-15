// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// `import.meta.url` is not a file URL under the jsdom environment, so paths are
// resolved from the repo root instead.
const repoFile = (relative: string) => readFileSync(path.resolve(__dirname, '..', relative), 'utf-8');

// `.claude/launch.json` is a third copy of the dev commands, after AGENTS.md and
// `docs/src/running-from-source.md`, and nothing else pins it to the scripts it
// duplicates. A launcher that is quietly wrong is worse than no launcher, so a
// script or port rename has to fail here rather than at someone's next `pnpm dev`.
// #2011
const launch = JSON.parse(repoFile('.claude/launch.json')) as {
    version: string;
    configurations: { name: string; runtimeExecutable: string; runtimeArgs: string[]; port: number }[];
};
const packageJson = JSON.parse(repoFile('package.json')) as {
    scripts: Record<string, string>;
};
const viteConfig = repoFile('vite.config.ts');

const configuration = (name: string) => {
    const found = launch.configurations.find((entry) => entry.name === name);
    if (found === undefined) {
        throw new Error(`no ${name} configuration in .claude/launch.json`);
    }
    return found;
};

describe('.claude/launch.json', () => {
    it('names each server once', () => {
        const names = launch.configurations.map((entry) => entry.name);
        expect(names).toEqual(['backend', 'frontend']);
    });

    it('runs the backend on the port vite proxies /api to', () => {
        // The pair only works together, and the proxy target is the side that
        // decides: change it and this entry starts a server the frontend cannot see.
        const proxied = viteConfig.match(/'\/api':\s*'http:\/\/localhost:(\d+)'/);
        expect(proxied).not.toBeNull();
        expect(configuration('backend').port).toBe(Number(proxied?.[1]));
    });

    it('starts the backend the way the dev pairing documents', () => {
        // AGENTS.md pairs `pnpm dev` with `flask:start-debug`, not `flask:start` —
        // the difference is the backend logs you want while working on the UI.
        const command = configuration('backend').runtimeArgs.join(' ');
        const script = packageJson.scripts['flask:start-debug'];
        expect(script).toBeDefined();
        for (const fragment of script.replace('DEBUG=true ', '').split(' ')) {
            expect(command).toContain(fragment);
        }
        expect(command).toContain('DEBUG=true');
    });

    it('starts the frontend through the dev script rather than a copy of it', () => {
        expect(packageJson.scripts.dev).toBeDefined();
        expect(configuration('frontend').runtimeArgs.join(' ')).toContain('pnpm run dev');
    });

    it('aligns node before running pnpm, because the launcher inherits the parent', () => {
        // `engines.node` is pinned and a launcher spawns this with whatever Node the
        // editor or agent had, which is usually the system default. Without this,
        // pnpm refuses before Vite starts.
        expect(configuration('frontend').runtimeArgs.join(' ')).toContain('nvm use');
    });
});
