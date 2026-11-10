"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const LoadingContext = createContext<{ show: () => void; hide: () => void } | null>(null);

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const count = useRef(0);

  const show = useCallback(() => {
    count.current += 1;
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    count.current = Math.max(0, count.current - 1);
    if (count.current === 0) setVisible(false);
  }, []);

  return (
    <LoadingContext.Provider value={{ show, hide }}>
      {children}
      {visible && (
        <div className="bg-background/70 fixed inset-0 z-100 flex items-center justify-center backdrop-blur-sm">
          <svg width="88" height="88" viewBox="0 0 200 200" className="animate-in fade-in-0 zoom-in-75 duration-300">
            <defs>
              <linearGradient id="loading-moon" x1="0.1" y1="0.1" x2="0.95" y2="0.9">
                <stop offset="0%" stopColor="#fff6da" />
                <stop offset="38%" stopColor="#ffd24a" />
                <stop offset="72%" stopColor="#f6a93c" />
                <stop offset="100%" stopColor="#e2852a" />
              </linearGradient>
              <radialGradient id="loading-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffd24a" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#ffd24a" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="100" cy="100" r="60" fill="url(#loading-glow)" />
            <g style={{ transformOrigin: "100px 100px", animation: "moonxch-spin 2.2s linear infinite" }}>
              <ellipse cx="100" cy="100" rx="60" ry="21" fill="none" stroke="#ece6fa" strokeOpacity="0.8" strokeWidth="3" />
            </g>
            <g style={{ transformOrigin: "100px 100px", animation: "moonxch-spin-reverse 2.8s linear infinite" }}>
              <ellipse cx="100" cy="100" rx="60" ry="21" fill="none" stroke="#9d5cff" strokeOpacity="0.6" strokeWidth="3" />
            </g>
            <circle cx="100" cy="100" r="42" fill="url(#loading-moon)" />
          </svg>
          <style>{`
            @keyframes moonxch-spin { from { transform: rotate(-18deg); } to { transform: rotate(342deg); } }
            @keyframes moonxch-spin-reverse { from { transform: rotate(42deg); } to { transform: rotate(-318deg); } }
          `}</style>
        </div>
      )}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) throw new Error("useLoading must be used within LoadingProvider");
  return ctx;
}
