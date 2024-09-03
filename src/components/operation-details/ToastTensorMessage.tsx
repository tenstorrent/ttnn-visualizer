import 'styles/components/ToastTensorMessage.scss';

interface ToastTensorMessageProps {
    id: number | string;
    colour?: string;
}

const ToastTensorMessage = ({ id, colour }: ToastTensorMessageProps) => (
    <div className='toast-tensor-message'>
        <div
            className='memory-color-block'
            style={colour ? { backgroundColor: colour } : {}}
        />

        <span>
            {typeof id === 'string' ? 'Buffer' : 'Tensor'} <strong>{id}</strong> selected
        </span>
    </div>
);

export default ToastTensorMessage;
