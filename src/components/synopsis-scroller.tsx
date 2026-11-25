"use client";

import { useEffect, useRef, useState } from "react";

/** Synopsis dans une fenêtre de 2 lignes : s'il dépasse, il défile doucement (aller-retour). */
export function SynopsisScroller({ text }: { text: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLParagraphElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const measure = () => setShift(Math.max(0, inner.scrollHeight - box.clientHeight));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text]);

  return (
    <div ref={boxRef} className="mt-5 h-14 max-w-[520px] overflow-hidden">
      <p
        ref={innerRef}
        className="text-base leading-7 text-[#dad5e5] motion-reduce:!animate-none"
        style={shift > 0 ? ({
          "--shift": `-${shift}px`,
          animation: `av-synopsis ${Math.max(8, shift / 12)}s ease-in-out infinite alternate`,
        } as React.CSSProperties) : undefined}
      >
        {text}
      </p>
    </div>
  );
}
