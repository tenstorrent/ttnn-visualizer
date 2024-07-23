import classNames from 'classnames';
import 'styles/components/LoadingSpinner.scss';

export enum LoadingSpinnerSizes {
    SMALL = 'small',
}

interface LoadingSpinnerProps {
    size?: LoadingSpinnerSizes;
}

function LoadingSpinner({ size }: LoadingSpinnerProps) {
    return (
        <div
            className={classNames('loading-spinner', {
                small: size === LoadingSpinnerSizes.SMALL,
            })}
        >
            <div />
            <div />
            <div />
            <div />
        </div>
    );
}

export default LoadingSpinner;
