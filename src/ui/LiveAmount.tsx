import { useLayoutEffect, useRef, useState } from "react";
import { money } from "./format";

function Digits({ value }: { value: number }) {
  const [whole, fraction] = money(value, 4).split(".");
  return (
    <>
      <span className="amount-whole">{whole}</span>
      <span className="amount-decimal" aria-hidden="true">.</span>
      <span className="amount-fraction">{fraction}</span>
    </>
  );
}

export function LiveAmount({
  value,
  dailyMaximum,
}: {
  value: number;
  dailyMaximum: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState<number>();
  // Size for the daily maximum, so crossing a digit boundary does not resize live text.
  const measure = Math.max(value, dailyMaximum);
  useLayoutEffect(() => {
    const box = container.current;
    const text = probe.current;
    if (!box || !text) return;
    const fit = () => {
      const width = Math.max(1, box.clientWidth - 12);
      const measured = text.getBoundingClientRect().width;
      const base = parseFloat(getComputedStyle(text).fontSize);
      setFontSize(
        measured > width
          ? Math.max(16, Math.floor((base * width) / measured))
          : undefined,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    observer.observe(text);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="amount" ref={container}>
      <div className="amount-probe" aria-hidden="true">
        <span ref={probe} className="amount-measure">
          <Digits value={measure} />
        </span>
      </div>
      <div className="amount-value" style={{ fontSize }}>
        <Digits value={value} />
      </div>
    </div>
  );
}
