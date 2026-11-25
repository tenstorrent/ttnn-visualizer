// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { getCompiledRules, getCompiledStylesheet } from './helpers/compiledStylesheets';

const DASH = /\.hardware-counter-missing(?![\w-])/;

const getDashRules = (path: string) =>
    getCompiledRules(getCompiledStylesheet(path)).filter((rule) =>
        rule.selectors.some((selector) => DASH.test(selector)),
    );

describe('MissingValue styles', () => {
    it('styles the dash from its own sheet, so it reads the same wherever it is rendered', () => {
        const [rule, ...rest] = getDashRules('src/scss/components/MissingValue.scss');

        expect(rest).toEqual([]);
        expect(rule.selectors).toEqual(['.hardware-counter-missing']);
        expect(rule.body).toMatch(/cursor:\s*help/);
    });

    it("leaves the dash to that sheet rather than the counters panel's", () => {
        expect(getDashRules('src/scss/components/DeviceOperationUtilization.scss')).toEqual([]);
    });
});
