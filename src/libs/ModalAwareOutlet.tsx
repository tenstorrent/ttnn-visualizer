// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useLocation, useRoutes } from 'react-router-dom';
import { routeObjectList } from '../definitions/RouteObjectList';

export function ModalAwareOutlet() {
    const location = useLocation();
    const state = location.state as { background?: Location };
    const backgroundLocation = state?.background;

    return useRoutes(routeObjectList, backgroundLocation || location);
}
