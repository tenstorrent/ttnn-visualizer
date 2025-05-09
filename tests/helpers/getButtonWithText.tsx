import { screen } from '@testing-library/dom';

const getButtonWithText = (text: string) => {
    return screen.getByRole('button', { name: new RegExp(text, 'i') });
};

export default getButtonWithText;
