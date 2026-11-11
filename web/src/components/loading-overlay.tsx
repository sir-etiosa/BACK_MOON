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
        <div className="bg-background/80 fixed inset-0 z-100 flex items-center justify-center backdrop-blur-sm">
          <svg
            width="128"
            height="128"
            viewBox="0 0 200 200"
            className="animate-in fade-in-0 zoom-in-75 duration-200"
            style={{ filter: "drop-shadow(0 4px 24px rgba(255,210,74,0.25))" }}
          >
            <defs>
              <linearGradient id="loading-moon" x1="0.1" y1="0.1" x2="0.95" y2="0.9">
                <stop offset="0%" stopColor="#fff6da" />
                <stop offset="38%" stopColor="#ffd24a" />
                <stop offset="72%" stopColor="#f6a93c" />
                <stop offset="100%" stopColor="#e2852a" />
              </linearGradient>
              <radialGradient id="loading-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ffd24a" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#ffd24a" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="loading-crater" cx="35%" cy="32%" r="75%">
                <stop offset="0%" stopColor="#c9731f" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#c9731f" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="100" cy="100" r="62" fill="url(#loading-glow)" />
            <g style={{ transformOrigin: "100px 100px", animation: "moonxch-spin 1.6s linear infinite" }}>
              <ellipse cx="100" cy="100" rx="60" ry="21" fill="none" stroke="#ece6fa" strokeOpacity="0.9" strokeWidth="3.5" />
            </g>
            <g style={{ transformOrigin: "100px 100px", animation: "moonxch-spin-reverse 2s linear infinite" }}>
              <ellipse cx="100" cy="100" rx="60" ry="21" fill="none" stroke="#9d5cff" strokeOpacity="0.7" strokeWidth="3.5" />
            </g>
            <circle cx="100" cy="100" r="42" fill="url(#loading-moon)" />
            <circle cx="100" cy="100" r="42" fill="none" stroke="#fff6da" strokeOpacity="0.35" strokeWidth="1.5" />
            <circle cx="112" cy="88" r="6" fill="url(#loading-crater)" />
            <circle cx="122" cy="110" r="4.5" fill="url(#loading-crater)" />
            <circle cx="92" cy="118" r="3" fill="url(#loading-crater)" />
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
