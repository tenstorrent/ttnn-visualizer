// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonVariant, Collapse, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import React from 'react';
import { JSX } from 'react/jsx-runtime';
import 'styles/components/Collapsible.scss';
import classNames from 'classnames';

interface CollapsibleProps {
    label: string | JSX.Element;
    additionalElements?: string | JSX.Element;
    isOpen?: boolean;
    collapseClassName?: string;
    contentStyles?: React.CSSProperties;
    contentClassName?: string;
    keepChildrenMounted?: boolean;
    onExpandToggle?: (state: boolean) => void;
    isDisabled?: boolean;
    children?: React.ReactNode;
}

const Collapsible = ({
    label,
    additionalElements = undefined,
    isOpen = true,
    collapseClassName = '',
    contentStyles = {},
    contentClassName = '',
    keepChildrenMounted = true,
    onExpandToggle,
    children,
    isDisabled = false,
}: CollapsibleProps) => {
    const [isOpenState, setIsOpenState] = React.useState(isOpen);
    const [prevIsOpenProp, setPrevIsOpenProp] = React.useState(isOpen);
    const icon = isOpenState ? IconNames.CARET_UP : IconNames.CARET_DOWN;

    if (isOpen !== prevIsOpenProp) {
        setPrevIsOpenProp(isOpen);
        setIsOpenState(isOpen);
    }

    return (
        <div className={classNames('collapsible-component', collapseClassName)}>
            <div className='collapsible-controls'>
                {children && (
                    <Button
                        size={Size.SMALL}
                        variant={ButtonVariant.MINIMAL}
                        className='collapsible-button'
                        onClick={
                            !isDisabled
                                ? () => {
                                      if (onExpandToggle) {
                                          onExpandToggle(!isOpenState);
                                      }
                                      setIsOpenState(!isOpenState);
                                  }
                                : undefined
                        }
                        endIcon={icon}
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
                    <div
                        className={classNames(contentClassName)}
                        style={contentStyles}
                    >
                        {children}
                    </div>
                </Collapse>
            )}
        </div>
    );
};

export default Collapsible;
export const COLLAPSIBLE_EMPTY_CLASS = 'empty-collapsible';
