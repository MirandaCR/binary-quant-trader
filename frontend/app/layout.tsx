import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";

export const metadata: Metadata = {
  title: "Binary Bot | Trading Dashboard",
  description: "Algorithmic binary options trading with AI, Statistical, Physics & Math strategies",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg-base text-gray-100 min-h-screen antialiased">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "#111827",
              color: "#f9fafb",
              border: "1px solid #1f2937",
              borderRadius: "8px",
              fontSize: "13px",
            },
            success: { iconTheme: { primary: "#10b981", secondary: "#111827" } },
            error:   { iconTheme: { primary: "#ef4444", secondary: "#111827" } },
          }}
        />
      </body>
    </html>
  );
}
