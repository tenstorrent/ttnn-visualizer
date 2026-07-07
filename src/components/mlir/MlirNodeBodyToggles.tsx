// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Switch } from '@blueprintjs/core';
import 'styles/components/MlirNodeBodyToggles.scss';

export interface MlirNodeBodyTogglesState {
    location: boolean;
    shapes: boolean;
}

interface MlirNodeBodyTogglesProps {
    value: MlirNodeBodyTogglesState;
    onChange: (next: MlirNodeBodyTogglesState) => void;
}

const MlirNodeBodyToggles = ({ value, onChange }: MlirNodeBodyTogglesProps) => (
    <div className='mlir-node-body-toggles'>
        <Switch
            checked={value.location}
            label='Show source location'
            onChange={(event) => onChange({ ...value, location: event.currentTarget.checked })}
        />
        <Switch
            checked={value.shapes}
            label='Show shapes'
            onChange={(event) => onChange({ ...value, shapes: event.currentTarget.checked })}
        />
    </div>
);

export default MlirNodeBodyToggles;
