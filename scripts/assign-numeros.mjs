/**
 * Attribue à chaque fiche du catalogue un NUMÉRO PUBLIC alphabétique.
 *
 * `/anime/1`, `/anime/2`, … dans l'ordre des titres (locale fr, insensible à la
 * casse). Seules les fiches réellement servies reçoivent un numéro : celles
 * qui ont un `tmdbId` et une affiche (les autres n'ont pas de page).
 *
 * Le numéro est STABLE : une fiche qui en a déjà un le garde, seules les
 * nouvelles fiches prennent les numéros suivants. Relancer le script ne
 * décale donc jamais les URLs existantes.
 *
 *   node scripts/assign-numeros.mjs [--force]
 *
 * `--force` recalcule tout depuis zéro (à n'utiliser qu'avant la mise en
 * ligne : tous les liens changent).
 */
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const force = process.argv.includes("--force");
const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const col = client.db(env.MONGODB_DB).collection("catalogue");

// TOUTES les fiches servies reçoivent un numéro : celles enrichies par TMDB
// comme les fiches importées du catalogue (sans tmdbId). Seule condition :
// un titre et une affiche, sinon la page n'a rien à montrer.
const filter = {
  $and: [
    { $or: [{ affiche: { $nin: ["", null] } }, { afficheSmall: { $nin: ["", null] } }] },
    { title: { $nin: [null, ""] } },
  ],
};

const fiches = await col.find(filter, { projection: { title: 1, tmdbId: 1, numero: 1 } }).toArray();
console.log("fiches servies :", fiches.length);

const sorted = [...fiches].sort((a, b) =>
  String(a.title).localeCompare(String(b.title), "fr", { sensitivity: "base" }),
);

let next = force ? 1 : Math.max(0, ...fiches.map((f) => Number(f.numero) || 0)) + 1;
const taken = new Set(force ? [] : fiches.map((f) => Number(f.numero)).filter((n) => n > 0));
const updates = [];

for (const fiche of sorted) {
  const current = Number(fiche.numero);
  if (!force && current > 0) continue;
  while (taken.has(next)) next += 1;
  taken.add(next);
  updates.push({ updateOne: { filter: { _id: fiche._id }, update: { $set: { numero: next } } } });
  next += 1;
}

if (updates.length === 0) {
  console.log("rien à faire : toutes les fiches ont déjà un numéro");
} else {
  for (let i = 0; i < updates.length; i += 500) {
    await col.bulkWrite(updates.slice(i, i + 500));
  }
  console.log("numéros attribués :", updates.length);
}

await col.createIndex({ numero: 1 }, { unique: true, sparse: true, name: "numero_unique" });

// Contrôle : les trois premiers titres et quelques repères.
const check = await col
  .find({ numero: { $gt: 0 } }, { projection: { numero: 1, title: 1, tmdbId: 1 } })
  .sort({ numero: 1 })
  .limit(5)
  .toArray();
console.log("début :", check.map((c) => `${c.numero}. ${c.title}`).join(" | "));
const total = await col.countDocuments({ numero: { $gt: 0 } });
console.log("fiches numérotées :", total);

await client.close();
