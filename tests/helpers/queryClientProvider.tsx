// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * A fresh client per mount, not a module-level singleton. Queries with a non-zero
 * `staleTime` (the host-key offer prompt is one) otherwise serve a neighbouring test's
 * cached data instead of running their own `queryFn`, so an assertion can pass without
 * exercising the fetch it claims to cover.
 */
export const QueryProvider = ({ children }: { children: React.ReactNode }) => {
    const [queryClient] = useState(() => new QueryClient());

    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};
