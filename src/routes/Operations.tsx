// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import OperationList from '../components/OperationList';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';

export default function Operations() {
    useClearSelectedBuffer();

    return (
        <>
            <Helmet title='Operations' />
            <OperationList />
        </>
    );
}
