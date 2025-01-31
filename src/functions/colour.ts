// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import tinycolor from 'tinycolor2';

export const getLightlyDimmedColour = (colour: string) => tinycolor(colour).desaturate(15).darken(5).toString();
export const getDimmedColour = (colour: string) => tinycolor(colour).desaturate(40).darken(15).toString();
