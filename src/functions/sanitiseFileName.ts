// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

const sanitiseFileName = (fileName: string): string => fileName.replace(/\.[^/.]+$/, '');

export default sanitiseFileName;
