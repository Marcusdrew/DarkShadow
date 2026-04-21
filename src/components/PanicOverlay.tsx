import { useEffect, useState } from "react";

/**
 * Functional fake calculator shown after a panic wipe.
 * Stays mounted in React so it doesn't blank the app on navigation.
 */
export function PanicOverlay({ onClose }: { onClose: () => void }) {
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);

  useEffect(() => {
    document.title = "Calculator";
  }, []);

  const press = (k: string) => {
    if ("0123456789".includes(k)) {
      setDisplay((d) => (fresh || d === "0" ? k : d + k));
      setFresh(false);
      return;
    }
    if (k === ".") {
      setDisplay((d) => (d.includes(".") ? d : d + "."));
      setFresh(false);
      return;
    }
    if (k === "C") {
      setDisplay("0");
      setPrev(null);
      setOp(null);
      setFresh(true);
      return;
    }
    if (["+", "−", "×", "÷"].includes(k)) {
      setPrev(parseFloat(display));
      setOp(k);
      setFresh(true);
      return;
    }
    if (k === "=") {
      const cur = parseFloat(display);
      if (prev != null && op) {
        let r = cur;
        if (op === "+") r = prev + cur;
        if (op === "−") r = prev - cur;
        if (op === "×") r = prev * cur;
        if (op === "÷") r = cur === 0 ? 0 : prev / cur;
        setDisplay(String(parseFloat(r.toPrecision(12))));
        setPrev(null);
        setOp(null);
        setFresh(true);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#f0f0f0] flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg p-4 w-[280px]">
        <input
          value={display}
          readOnly
          className="w-full text-right text-2xl px-3 py-3 border border-gray-200 rounded mb-2 font-mono text-gray-800"
        />
        <div className="grid grid-cols-4 gap-2">
          {["C", "÷", "×", "−",
            "7", "8", "9", "+",
            "4", "5", "6", "=",
            "1", "2", "3", "0",
            "."].map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              className="bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-800 py-3 rounded text-lg font-medium transition-colors"
            >
              {k}
            </button>
          ))}
        </div>
        <button
          onDoubleClick={onClose}
          title="double-click to restore"
          className="w-full mt-2 text-[10px] text-gray-300 hover:text-gray-500"
        >
          ·
        </button>
      </div>
    </div>
  );
}