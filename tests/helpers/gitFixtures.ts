// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { formatShortSha } from '../../src/functions/formatting';

export const MOCK_FULL_GIT_SHA = 'abcdef0123456789abcdef0123456789abcdef01';

export const MOCK_SHORT_GIT_SHA = formatShortSha(MOCK_FULL_GIT_SHA);

export const MOCK_HTTP_GIT_URL = 'https://github.com/foo/bar.git';

export const MOCK_SSH_GIT_URL = 'git@github.com:foo/bar.git';
