// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Component, ReactNode } from 'react';

interface ChromeErrorBoundaryProps {
    children: ReactNode;
    // A change retries the children, so a fault tied to one report does not hide them for the session
    resetKey: string;
}

interface ChromeErrorBoundaryState {
    hasError: boolean;
}

/**
 * @description Contains a render fault in always-mounted chrome, such as the footer. Without it the
 * fault reaches the router's root `errorElement`, which replaces every route — Home included — with
 * the error page. Losing the chrome is the lesser failure, so the fallback renders nothing.
 *
 * React still logs the caught error to the console, in production builds too, so the fault stays
 * visible without a `componentDidCatch` here.
 *
 * A class component because React has no hook form of `getDerivedStateFromError`; it is small
 * enough that a dependency such as `react-error-boundary` would not pay for itself.
 */
class ChromeErrorBoundary extends Component<ChromeErrorBoundaryProps, ChromeErrorBoundaryState> {
    override state: ChromeErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(): ChromeErrorBoundaryState {
        return { hasError: true };
    }

    override componentDidUpdate(previousProps: ChromeErrorBoundaryProps) {
        if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false });
        }
    }

    override render() {
        return this.state.hasError ? null : this.props.children;
    }
}

export default ChromeErrorBoundary;
