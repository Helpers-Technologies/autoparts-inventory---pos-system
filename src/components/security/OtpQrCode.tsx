import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function OtpQrCode({ uri, size = 184 }: { uri: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDataUrl("");
    if (!uri) return;
    void QRCode.toDataURL(uri, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#06111f", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setDataUrl(url);
    }).catch(() => {
      if (!cancelled) setDataUrl("");
    });
    return () => {
      cancelled = true;
    };
  }, [uri, size]);

  if (!dataUrl) {
    return (
      <div
        className="grid place-items-center rounded-2xl border border-line bg-white text-xs text-slate-500"
        style={{ width: size, height: size }}
      >
        جاري تجهيز QR...
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="QR لإضافة الحساب إلى تطبيق المصادقة"
      className="rounded-2xl border border-line bg-white p-2 shadow-sm"
    />
  );
}
