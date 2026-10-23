interface ProgressCounterProps {
  done: number;
  total: number;
}

export default function ProgressCounter({ done, total }: ProgressCounterProps) {
  return (
    <span className="upload-counter" role="status" aria-live="polite">
      {done} / {total}
    </span>
  );
}
