import { ScanPage } from "@/components/ScanPage";
import { ScannerShell } from "@/components/scanner/ScannerShell";

export default function Home() {
  return (
    <ScannerShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScanPage />
      </div>
    </ScannerShell>
  );
}
