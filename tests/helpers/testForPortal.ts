import { expect } from 'vitest';

const PORTAL_CLASS = '.bp6-portal';

const testForPortal = () => {
    const portal = document.querySelector(PORTAL_CLASS);
    expect(portal).not.toBeNull();
};

export default testForPortal;
