// ─────────────────────────────────────────────────────────────────────────────
// pages/NotFound.tsx  —  404 catch-all page
//
// Shown for any route that doesn't match a defined path in App.tsx.
// Logs the attempted path to the console for debugging.
// ─────────────────────────────────────────────────────────────────────────────
import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#02060b]">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4 text-white">404</h1>
        <p className="text-xl text-[#9eb0c7] mb-4">Page not found</p>
        <a href="/" className="text-[#4384ff] hover:text-[#2f70ff] underline">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
