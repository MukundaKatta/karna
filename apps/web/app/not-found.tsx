export default function NotFound() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "16px", textAlign: "center", padding: "32px" }}>
      <h1 style={{ fontSize: "48px", fontWeight: "bold", color: "#94a3b8" }}>404</h1>
      <p style={{ color: "#64748b", fontSize: "18px" }}>Page not found</p>
      <a href="/chat" style={{ marginTop: "16px", padding: "12px 24px", borderRadius: "8px", backgroundColor: "#4f46e5", color: "#fff", textDecoration: "none", fontWeight: 500 }}>
        Go to Dashboard
      </a>
    </div>
  );
}
