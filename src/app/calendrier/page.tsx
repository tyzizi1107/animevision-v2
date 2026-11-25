import type { Metadata } from "next";
import { CalendarView } from "@/components/calendar/calendar-view";
import { AlertTriangleIcon } from "@/components/icons";
import { getCalendar, getWeekInfo, type CalendarDay } from "@/lib/calendar";

export const metadata: Metadata = {
  title: "Calendrier des sorties",
  description:
    "Planning hebdomadaire des sorties d'animés en VOSTFR et VF, jour par jour, sur AnimeVision.",
};

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const { todayIndex, week } = getWeekInfo();

  let days: CalendarDay[] = [];
  let error: string | null = null;

  try {
    days = await getCalendar();
  } catch (cause) {
    console.error("[calendrier] lecture MongoDB impossible :", cause);
    error = "Le calendrier est momentanément indisponible. Vérifiez la connexion MongoDB puis réessayez.";
  }

  return (
    <main className="relative isolate mx-auto min-h-screen max-w-[1600px] overflow-hidden px-4 pb-20 pt-28 sm:px-6 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[540px] bg-[radial-gradient(ellipse_at_16%_0%,rgba(65,0,154,0.22),transparent_48%),radial-gradient(ellipse_at_92%_12%,rgba(169,120,245,0.1),transparent_36%)]" />
      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-400/25 bg-red-500/[0.06] p-5 sm:flex-row sm:items-center">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-300">
            <AlertTriangleIcon className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-black text-white">Planning des sorties indisponible</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted">{error}</p>
          </div>
        </div>
      ) : (
        <CalendarView days={days} todayIndex={todayIndex} week={week} />
      )}
    </main>
  );
}
