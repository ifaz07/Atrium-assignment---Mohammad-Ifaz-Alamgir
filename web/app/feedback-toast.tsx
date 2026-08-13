type FeedbackToastProps = {
  message: string;
  tone: 'success' | 'error';
  onClose: () => void;
};

export default function FeedbackToast({ message, tone, onClose }: FeedbackToastProps) {
  if (!message) return null;

  return (
    <div className={`feedback-toast feedback-${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
      <div>
        <strong>{tone === 'error' ? 'Booking not completed' : 'Success'}</strong>
        <span>{message}</span>
      </div>
      <button className="feedback-close" type="button" aria-label="Close notification" onClick={onClose}>×</button>
    </div>
  );
}
