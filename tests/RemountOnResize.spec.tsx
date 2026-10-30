// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { Classes, Slider } from '@blueprintjs/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemountOnResize from '../src/components/RemountOnResize';
import { getObserverFor, installCapturingResizeObserver } from './helpers/capturingResizeObserver';

const SLIDER_MAX = 100;
const TRACK_WIDTH = 400;
const CLICK_X = 200;

// jsdom has no layout, so the slider's track reports whatever width this holds
let trackWidth = 0;

const renderSlider = (onChange: (value: number) => void) =>
    render(
        <RemountOnResize data-testid='wrapper'>
            <Slider
                min={0}
                max={SLIDER_MAX}
                stepSize={1}
                value={0}
                onChange={onChange}
            />
        </RemountOnResize>,
    );

/**
 * Presses the slider track `CLICK_X` pixels in; jsdom puts the handle's centre at 0. The press is never
 * released: unmounting the slider removes its drag listeners, and releasing a handle moved to an infinite value
 * throws inside Blueprint.
 */
const pressTrack = () => {
    fireEvent.mouseDown(document.querySelector(`.${Classes.SLIDER}`)!, { clientX: CLICK_X });
};

describe('RemountOnResize', () => {
    beforeEach(() => {
        installCapturingResizeObserver();
        trackWidth = 0;
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function getClientWidth(
            this: HTMLElement,
        ) {
            return this.classList.contains(Classes.SLIDER_TRACK) ? trackWidth : 0;
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('remounts its children when its width changes, and only then', () => {
        renderSlider(vi.fn());
        const observer = getObserverFor(screen.getByTestId('wrapper'));
        const firstHandle = screen.getByRole('slider');

        observer.report(TRACK_WIDTH);
        const resizedHandle = screen.getByRole('slider');
        expect(resizedHandle).not.toBe(firstHandle);

        observer.report(TRACK_WIDTH);
        expect(screen.getByRole('slider')).toBe(resizedHandle);
    });

    // Documents why the wrapper exists: if this starts failing, Blueprint re-measures on its own again and
    // RemountOnResize may no longer be needed.
    it('is needed because a Blueprint slider keeps the track width it mounted with', () => {
        const onChange = vi.fn();
        renderSlider(onChange);

        trackWidth = TRACK_WIDTH;
        pressTrack();

        expect(onChange).toHaveBeenLastCalledWith(SLIDER_MAX);
    });

    it('lets a slider that mounted at zero width convert pointer positions once its width is known', () => {
        const onChange = vi.fn();
        renderSlider(onChange);

        trackWidth = TRACK_WIDTH;
        getObserverFor(screen.getByTestId('wrapper')).report(TRACK_WIDTH);
        pressTrack();

        expect(onChange).toHaveBeenLastCalledWith((CLICK_X / TRACK_WIDTH) * SLIDER_MAX);
    });
});
