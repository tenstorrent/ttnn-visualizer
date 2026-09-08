// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useLocation, useRoutes } from 'react-router';
import { routeObjectList } from '../routes/routeObjectList';
import { getModalBackground } from '../functions/modalRoute';

export function ModalAwareOutlet() {
    const location = useLocation();
    const backgroundLocation = getModalBackground(location);

    return useRoutes(routeObjectList, backgroundLocation || location);
}
