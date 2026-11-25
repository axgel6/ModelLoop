import { useEffect, useState } from "react";
import { useT } from "../i18n";

interface ConnectionBannerProps {
  message?: string;
}

export default function ConnectionBanner({ message }: ConnectionBannerProps) {
  const tr = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 730);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="connection-banner-wrap">
      <div className="connection-banner">{message ?? tr("Olly is waking up. This usually takes about a minute.")}</div>
    </div>
  );
}
