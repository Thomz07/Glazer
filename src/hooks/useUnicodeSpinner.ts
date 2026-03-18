import { useEffect, useMemo, useState } from "react";
import spinners from "unicode-animations";

const DEFAULT_SPINNER_NAME = "diagswipe";

type SpinnerName = keyof typeof spinners;

export function useUnicodeSpinner(active: boolean, spinnerName: SpinnerName = DEFAULT_SPINNER_NAME) {
  const spinner = useMemo(() => spinners[spinnerName] ?? spinners[DEFAULT_SPINNER_NAME], [spinnerName]);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setFrameIndex(0);
      return;
    }

    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % spinner.frames.length);
    }, spinner.interval);

    return () => {
      window.clearInterval(timer);
    };
  }, [active, spinner]);

  if (!active) {
    return "";
  }

  return spinner.frames[frameIndex] ?? spinner.frames[0] ?? "";
}
