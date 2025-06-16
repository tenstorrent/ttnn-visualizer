// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { screen } from '@testing-library/dom';

const getButtonWithText = (text: string) => {
    return screen.getByRole('button', { name: new RegExp(text, 'i') });
};

export default getButtonWithText;
