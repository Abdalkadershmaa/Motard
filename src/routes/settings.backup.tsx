import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Download, Upload, Save } from "lucide-react";
import { PageCard } from "@/components/layout/PageCard";
import { Button } from "@/components/ui/button";
import { settings, logActivity } from "@/presentation/hooks/useSettings";

const ALLOWED_SETTING_KEYS = [
  "company",
  "currencies",
  "paymentMethods",
  "taxes",
  "units",
  "warehouses",
  "printing",
  "users",
  "activity",
  "companyId",
  "version",
] as const;

function validateBackup(data: unknown): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.version === "number" &&
    d.version === 1 &&
    typeof d.exportedAt === "string" &&
    typeof d.settings === "object" &&
    d.settings !== null &&
    !Array.isArray(d.settings)
  );
}

export const Route = createFileRoute("/settings/backup")({ component: BackupPage });

function BackupPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  const exportAll = () => {
    const payload = { version: 1, exportedAt: new Date().toISOString(), settings };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setLastBackup(new Date().toLocaleString("ar"));
    logActivity("النسخ الاحتياطي", "تصدير نسخة احتياطية");
  };
  const importAll = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (!validateBackup(data)) {
        alert("ملف غير صالح.");
        return;
      }
      const src = data.settings as Record<string, unknown>;
      for (const key of ALLOWED_SETTING_KEYS) {
        if (key in src) {
          (settings as Record<string, unknown>)[key] = src[key];
        }
      }
      logActivity("النسخ الاحتياطي", "استعادة من ملف", file.name);
      alert("تم استعادة الإعدادات بنجاح.");
    } catch {
      alert("فشل قراءة الملف.");
    }
  };

  return (
    <div className="space-y-4">
      <PageCard
        title="النسخ الاحتياطي والاستعادة"
        description="تصدير الإعدادات والبيانات كملف JSON، أو استيرادها من نسخة سابقة."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <button
            onClick={exportAll}
            className="flex flex-col items-center gap-2 rounded-xl border p-6 text-center transition hover:border-primary hover:bg-primary/5"
          >
            <Download className="h-6 w-6 text-primary" />
            <div className="text-sm font-semibold">تصدير نسخة احتياطية</div>
            <p className="text-xs text-muted-foreground">حفظ كل الإعدادات في ملف JSON.</p>
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-xl border p-6 text-center transition hover:border-primary hover:bg-primary/5"
          >
            <Upload className="h-6 w-6 text-primary" />
            <div className="text-sm font-semibold">استيراد نسخة احتياطية</div>
            <p className="text-xs text-muted-foreground">استعادة إعدادات النظام من ملف.</p>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])}
          />
        </div>
        {lastBackup && (
          <p className="mt-3 text-xs text-muted-foreground">
            <Save className="inline h-3 w-3 ml-1" /> آخر تصدير: {lastBackup}
          </p>
        )}
      </PageCard>
      <PageCard
        title="ملاحظة"
        description="عند ربط النظام بـ Lovable Cloud، ستصبح النسخ التلقائية الليلية متاحة."
      >
        <p className="text-sm text-muted-foreground">
          حالياً النسخ يدوية عبر تصدير/استيراد ملف JSON.
        </p>
      </PageCard>
    </div>
  );
}
