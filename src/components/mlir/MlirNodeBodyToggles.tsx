// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo } from 'react';
import { Button, ButtonVariant, Popover, PopoverInteractionKind, Position, Size, Switch } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/MlirNodeBodyToggles.scss';

export interface MlirNodeBodyTogglesState {
    location: boolean;
    shapes: boolean;
}

interface MlirNodeBodyTogglesProps {
    value: MlirNodeBodyTogglesState;
    onChange: (next: MlirNodeBodyTogglesState) => void;
}

const MlirNodeBodyTogglesInner = ({ value, onChange }: MlirNodeBodyTogglesProps) => {
    const activeCount = Number(value.location) + Number(value.shapes);
    return (
        <Popover
            minimal
            interactionKind={PopoverInteractionKind.CLICK}
            position={Position.BOTTOM_LEFT}
            content={
                <div className='mlir-node-body-toggles-menu'>
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
            }
        >
            <Button
                size={Size.SMALL}
                variant={ButtonVariant.MINIMAL}
                icon={IconNames.PROPERTIES}
                endIcon={IconNames.CARET_DOWN}
                active={activeCount > 0}
                text={activeCount > 0 ? String(activeCount) : undefined}
                aria-label='Node body overlays'
            />
        </Popover>
    );
};

const MlirNodeBodyToggles = memo(MlirNodeBodyTogglesInner);
MlirNodeBodyToggles.displayName = 'MlirNodeBodyToggles';

export default MlirNodeBodyToggles;
