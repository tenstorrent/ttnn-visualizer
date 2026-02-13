// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import tinycolor from 'tinycolor2';

export const getLightlyDimmedColour = (colour: string) => tinycolor(colour).desaturate(15).darken(5).toString();
export const getDimmedColour = (colour: string) => tinycolor(colour).desaturate(60).darken(15).toString();

export const cssVar = (name: string): string => {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
};
