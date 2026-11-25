import { MongoClient } from "mongodb";

const API_URL = "https://api.franime.fr/api/calendrier_data";
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "animevision";
const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const DAY_LABELS = new Map(DAYS.map((day) => [day, `${day[0].toUpperCase()}${day.slice(1)}`]));

if (!MONGODB_URI) throw new Error("MONGODB_URI absent de .env.local.");

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toCalendarEntry(row, index) {
  const id = row.id_anime;
  const language = text(row.lang).toLowerCase();
  const season = row.saison == null ? "" : String(row.saison);
  const episode = row.prochain_ep == null ? "" : String(row.prochain_ep);
  const poster = text(row.affiche);
  return {
    _id: `${id}:${language}:${season}:${episode || index}`,
    animeId: id,
    titre: text(row.title_anime) || "Sans titre",
    affiche: /^https?:\/\//i.test(poster) ? poster : "",
    genre: [],
    synopsis: "",
    saison: season,
    episode,
    heures: row.heures ?? null,
    minutes: row.minutes ?? null,
    banniere: text(row.banner) || "",
    sourceUpdatedAt: row.updatedDate ?? null,
    sourceUpdatedAtVF: row.updatedDateVF ?? null,
  };
}

async function fetchCalendar() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(API_URL, {
        headers: { Accept: "application/json", "User-Agent": "AnimeVision calendar sync/1.0" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`FrAnime HTTP ${response.status}.`);
      const payload = await response.json();
      if (payload?.success !== true || !Array.isArray(payload.data) || payload.data.length === 0) {
        throw new Error("Réponse calendrier FrAnime vide ou au format inattendu.");
      }
      return payload.data;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

const rows = await fetchCalendar();
const grouped = new Map(DAYS.map((day) => [day, { vo: [], vf: [] }]));
for (const [index, row] of rows.entries()) {
  const day = text(row?.jour).toLocaleLowerCase("fr-FR");
  const language = text(row?.lang).toLowerCase();
  if (!grouped.has(day) || !["vo", "vf"].includes(language) || row.id_anime == null) continue;
  grouped.get(day)[language].push(toCalendarEntry(row, index));
}

const validEntries = [...grouped.values()].reduce((sum, day) => sum + day.vo.length + day.vf.length, 0);
if (validEntries === 0) throw new Error("Aucune entrée calendrier valide reçue ; MongoDB n’a pas été modifié.");

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
try {
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  const collection = client.db(DB_NAME).collection("calendriers");
  const syncedAt = new Date();
  for (const [day, entries] of grouped) {
    const jour = DAY_LABELS.get(day);
    const filter = { jour: { $regex: `^${day}$`, $options: "i" } };
    const update = { $set: { jour, ...entries, source: "franime", syncedAt } };
    await collection.updateMany(filter, update);
    const sourceDocs = await collection.find({ ...filter, source: "franime" }, { projection: { _id: 1 } }).toArray();
    if (sourceDocs.length === 0) await collection.insertOne({ jour, ...entries, source: "franime", syncedAt });
    else if (sourceDocs.length > 1) {
      await collection.deleteMany({ _id: { $in: sourceDocs.slice(1).map((document) => document._id) } });
    }
  }
  const totals = [...grouped.values()].reduce((sum, day) => ({ vo: sum.vo + day.vo.length, vf: sum.vf + day.vf.length }), { vo: 0, vf: 0 });
  console.log(`Calendrier FrAnime — ${totals.vo} entrées VO et ${totals.vf} entrées VF enregistrées dans ${DB_NAME}.calendriers.`);
} finally {
  await client.close();
}
