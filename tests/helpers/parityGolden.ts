// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// What the agent's parity specs share when they read a golden from tests/data/.

const requireCases = <T>(cases: T[]) => {
    if (cases.length === 0) {
        throw new Error('A parity golden holds no cases; regenerate it with pnpm run agent:parity-golden.');
    }
    return cases;
};

// A golden's cases for it.each, labelled by position; an empty list fails the spec file.
export const indexedCases = <T>(cases: T[]) => requireCases(cases).map((entry, index) => [index, entry] as const);

// A golden's cases for it.each, labelled by name; an empty list fails the spec file.
export const namedCases = <T extends { name: string }>(cases: T[]) =>
    requireCases(cases).map((entry) => [entry.name, entry] as const);
