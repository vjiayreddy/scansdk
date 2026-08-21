import { LiveScanPage } from "@/components/LiveScanPage";
import { ScannerShell } from "@/components/scanner/ScannerShell";

export default function LivePage() {
  return (
    <ScannerShell>
      <LiveScanPage />
    </ScannerShell>
  );
}
