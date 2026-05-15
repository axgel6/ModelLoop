import { useEffect, useState } from "react";

interface ConnectionBannerProps {
  message?: string;
}

export default function ConnectionBanner({
  message = "Initializing backend services. Estimated wait time: ~1 minute.",
}: ConnectionBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 700);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="connection-banner-wrap">
      <div className="connection-banner">{message}</div>
    </div>
  );
}
