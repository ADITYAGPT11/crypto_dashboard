import { useState, useEffect } from "react";

const RealTimeClock = () => {
  // Lazy initializer runs only on mount (and once per mount), keeping render pure
  const [time, setTime] = useState<Date | null>(() => (typeof window === "undefined" ? null : new Date()));

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="status-item">
      <span>
        {time
          ? time.toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          : "--:--:--"}
      </span>
    </div>
  );
};

export default RealTimeClock;
