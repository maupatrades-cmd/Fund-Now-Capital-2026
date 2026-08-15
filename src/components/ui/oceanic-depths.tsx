// "Oceanic Depths" gradient exported as live CSS from the 21st.dev builder.
// It has no runtime dependencies and always fills its parent container.
export function GradientBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        height: "100%",
        containerType: "size",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "-0.8cqmin",
          filter: "blur(0.4cqmin)",
          backgroundColor: "#DFF6F2",
          backgroundImage:
            "radial-gradient(circle at 65.73% 46.88%, rgba(11, 59, 87, 1) 0%, rgba(11, 59, 87, 0) 42.5%), radial-gradient(circle at 28.56% 72.18%, rgba(30, 136, 168, 1) 0%, rgba(30, 136, 168, 0) 54.05%), radial-gradient(circle at 52.74% 17.34%, rgba(111, 211, 201, 1) 0%, rgba(111, 211, 201, 0) 65.95%), radial-gradient(circle at 78.57% 84.33%, rgba(223, 246, 242, 1) 0%, rgba(223, 246, 242, 0) 77.5%)",
        }}
      />
    </div>
  );
}
