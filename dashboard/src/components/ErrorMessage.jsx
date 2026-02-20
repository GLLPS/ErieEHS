export default function ErrorMessage({ message, onRetry }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
      <p className="text-red-700 text-sm mb-2">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm text-red-600 underline hover:text-red-800"
        >
          Try again
        </button>
      )}
    </div>
  );
}
