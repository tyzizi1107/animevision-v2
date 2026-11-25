import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || "animevision";
if (!uri) throw new Error("MONGODB_URI est absent de l'environnement.");

function renameField(object, english, french) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return false;
  let changed = false;
  if (!Object.hasOwn(object, french) && Object.hasOwn(object, english)) {
    object[french] = object[english];
    changed = true;
  }
  if (Object.hasOwn(object, english)) {
    delete object[english];
    changed = true;
  }
  return changed;
}

function localizeAnime(document) {
  const changed = [];
  for (const [english, french] of [["title", "titre"], ["altTitles", "autresNoms"], ["poster", "affiche"], ["banner", "banniere"]]) {
    if (renameField(document, english, french)) changed.push(english + " → " + french);
  }
  if (document.saisons && typeof document.saisons === "object") {
    for (const season of Object.values(document.saisons)) {
      if (!season || typeof season !== "object") continue;
      if (renameField(season, "poster", "affiche")) changed.push("affiche de saison");
      if (season.episodes && typeof season.episodes === "object") {
        for (const episode of Object.values(season.episodes)) {
          if (renameField(episode, "title", "titre")) changed.push("titre d’épisode");
        }
      }
    }
  }
  if (Array.isArray(document.adminOverrides)) {
    if (document.adminOverrides.includes("banner")) changed.push("adminOverrides");
    document.adminOverrides = [...new Set(document.adminOverrides.map((key) => key === "banner" ? "banniere" : key))];
  }
  return [...new Set(changed)];
}

function localizeAnnouncements(document) {
  return renameField(document, "title", "titre") ? ["titre d’annonce"] : [];
}

function localizeCalendar(document) {
  const changed = [];
  for (const language of ["vo", "vf"]) {
    if (!Array.isArray(document[language])) continue;
    for (const entry of document[language]) {
      if (renameField(entry, "title", "titre")) changed.push("titre de calendrier");
      if (renameField(entry, "poster", "affiche")) changed.push("affiche de calendrier");
    }
  }
  return [...new Set(changed)];
}

async function migrateCollection(db, collectionName, transform) {
  const collection = db.collection(collectionName);
  let updated = 0;
  let operations = [];
  for await (const document of collection.find({})) {
    const changes = transform(document);
    if (!changes.length) continue;
    const { _id, ...fields } = document;
    operations.push({ replaceOne: { filter: { _id }, replacement: fields } });
    if (operations.length >= 250) {
      const result = await collection.bulkWrite(operations, { ordered: false });
      updated += result.modifiedCount;
      operations = [];
      console.log(collectionName + " : " + updated + " document(s)…");
    }
  }
  if (operations.length) {
    const result = await collection.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount;
  }
  console.log(collectionName + " : " + updated + " document(s) mis à jour.");
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(databaseName);
  console.log("Migration des noms de champs dans " + databaseName + "…");
  await migrateCollection(db, "franime", localizeAnime);
  await migrateCollection(db, "annonces", localizeAnnouncements);
  await migrateCollection(db, "calendriers", localizeCalendar);
  console.log("Migration terminée. Les valeurs et les autres champs ont été conservés.");
} finally {
  await client.close();
}
