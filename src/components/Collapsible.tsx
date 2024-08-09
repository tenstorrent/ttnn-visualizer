// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { Button, Collapse } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import React, { useEffect } from 'react';
import { JSX } from 'react/jsx-runtime';
import '../scss/components/Collapsible.scss';

interface CollapsibleProps {
    label: string | JSX.Element;
    additionalElements?: string | JSX.Element;
    isOpen?: boolean;
    contentStyles?: React.CSSProperties;
    contentClassName?: string;
    keepChildrenMounted?: boolean;
    onExpandToggle?: () => void;
}

const Collapsible: React.FC<React.PropsWithChildren<CollapsibleProps>> = ({
    label,
    additionalElements = undefined,
    isOpen = true,
    contentStyles = {},
    contentClassName = '',
    keepChildrenMounted = true,
    onExpandToggle,
    children,
}) => {
    const [isOpenState, setIsOpenState] = React.useState(isOpen);
    useEffect(() => {
        setIsOpenState(isOpen);
    }, [isOpen]);

    const icon = isOpenState ? IconNames.CARET_UP : IconNames.CARET_DOWN;
    return (
        <div className='collapsible-component'>
            <div className='collapsible-controls'>
                {children && (
                    <Button
                        small
                        minimal
                        onClick={() => {
                            if (onExpandToggle) {
                                onExpandToggle();
                            }
                            setIsOpenState(!isOpenState);
                        }}
                        rightIcon={icon}
                    >
                        {label}
                    </Button>
                )}
                {!children && (
                    <div className='collapsible-label-wrap'>
                        <div className='collapsible-label'>{label}</div>
                    </div>
                )}
                {additionalElements && additionalElements}
            </div>
            {children && (
                <Collapse
                    isOpen={isOpenState}
                    keepChildrenMounted={keepChildrenMounted}
                >
                    <div className={contentClassName} style={contentStyles}>{children}</div>
                </Collapse>
            )}
        </div>
    );
};

export default Collapsible;
