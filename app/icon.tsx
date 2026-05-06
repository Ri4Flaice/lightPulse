import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: "#050505",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
        }}
      >
        {/* dot */}
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "#a6ff3d",
          }}
        />
        {/* dot */}
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "#a6ff3d",
          }}
        />
        {/* dash */}
        <div
          style={{
            width: 13,
            height: 5,
            borderRadius: 2,
            background: "#a6ff3d",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
