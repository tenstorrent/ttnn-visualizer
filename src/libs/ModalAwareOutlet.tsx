// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { RouteObject, useLocation, useRoutes } from 'react-router-dom';

export function ModalAwareOutlet({ routes }: { routes: RouteObject[] }) {
    const location = useLocation();
    const state = location.state as { background?: Location };
    const backgroundLocation = state?.background;

    return useRoutes(routes, backgroundLocation || location);
}
