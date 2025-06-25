// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { screen } from '@testing-library/dom';

const getAllButtonsWithText = (text: string) => {
    return screen.getAllByRole('button', { name: new RegExp(text, 'i') });
};

export default getAllButtonsWithText;
