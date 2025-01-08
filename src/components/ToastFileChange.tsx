interface ToastFileChangeProps {
    message: string;
    fileName: string;
}

const ToastFileChange = ({ message, fileName }: ToastFileChangeProps) => {
    return (
        <div>
            {message}
            <br />
            <strong>{fileName}</strong>
        </div>
    );
};

export default ToastFileChange;
