import { useMemo } from "react";

function randomHex(len: number) {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < len; i++) {
    s += chars[(i * 7 + len * 3) % chars.length];
    if (i % 2 === 1 && i < len - 1) s += " ";
  }
  return s;
}

export function HexStream({
  vertical = false,
  className = "",
}: {
  vertical?: boolean;
  className?: string;
}) {
  const stream = useMemo(() => randomHex(400), []);
  const repeated = stream + "    " + stream;

  if (vertical) {
    return (
      <div aria-hidden="true" className={`hex-stream ${className}`} style={{ writingMode: "vertical-rl" }}>
        <div className="animate-hex-scroll">{repeated}</div>
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={`hex-stream overflow-hidden ${className}`}>
      <div className="inline-block animate-hex-scroll">{repeated}</div>
    </div>
  );
}
