import { NextResponse } from "next/server";
import { getCalendar, getWeekInfo } from "@/lib/calendar";
import { calendrierVersApi } from "@/lib/api-localization";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const days = await getCalendar();
    const { todayIndex, week } = getWeekInfo();

    return NextResponse.json(
      calendrierVersApi(days, todayIndex, week),
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (cause) {
    console.error("[api/calendar] erreur :", cause);
    return NextResponse.json({ erreur: "Calendrier indisponible." }, { status: 503 });
  }
}
