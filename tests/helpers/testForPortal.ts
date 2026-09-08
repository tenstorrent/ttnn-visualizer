// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';
import { expect } from 'vitest';

const testForPortal = () => {
    const portal = document.querySelector(`.${Classes.PORTAL}`);
    expect(portal).not.toBeNull();
};

export default testForPortal;
