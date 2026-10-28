import type { L, ToolDef } from "./types.ts";

const q = (en: string, fr: string): L => ({ en, fr });

export const metadataTools: ToolDef[] = [
  {
    id: "inspect",
    title: q("See photo details", "Voir les infos de la photo"),
    summary: q("Camera, lens, settings, date, GPS position and everything else hidden in the file, with what it reveals.", "Appareil, objectif, réglages, date, position GPS et tout ce que cache le fichier, avec ce que ça révèle."),
    category: "metadata",
    input: "image",
    report: true,
    aliases: ["exif", "xmp", "iptc", "gps", "location", "camera", "info", "properties", "position", "appareil", "propriétés"],
    fields: [],
  },
  {
    id: "strip",
    title: q("Remove metadata", "Retirer les métadonnées"),
    summary: q("Remove the location, or every detail, without re-compressing: the pixels stay identical.", "Retirez la position, ou toutes les infos, sans recompresser : les pixels restent identiques."),
    category: "metadata",
    input: "image",
    aliases: ["exif", "gps", "location", "privacy", "clean", "scrub", "anonymize", "position", "nettoyer", "vie privée", "localisation"],
    fields: [
      {
        name: "remove",
        kind: "select",
        label: q("Remove", "Retirer"),
        default: "all",
        choices: [
          { value: "all", label: q("Everything (keeps the colour profile)", "Tout (garde le profil couleur)") },
          { value: "gps", label: q("Only the location", "Seulement la position") },
          { value: "private", label: q("Location, serial numbers and owner", "Position, numéros de série et propriétaire") },
        ],
      },
    ],
  },
  {
    id: "edit-meta",
    title: q("Edit date and credits", "Modifier date et crédits"),
    summary: q("Fix the date or a camera clock in the wrong time zone, set the author, copyright and description.", "Corrigez la date ou l'horloge d'un appareil mal réglé, renseignez auteur, copyright et description."),
    category: "metadata",
    input: "image",
    aliases: ["date", "time", "timezone", "author", "copyright", "artist", "description", "exif", "heure", "fuseau", "auteur"],
    fields: [
      { name: "shift", kind: "number", label: q("Shift the date by", "Décaler la date de"), min: -8760, max: 8760, step: 0.25, unit: "h", placeholder: q("No change", "Inchangée") },
      { name: "date", kind: "text", label: q("Or set the date to", "Ou fixer la date au"), placeholder: q("2024-07-14 18:30", "2024-07-14 18:30") },
      { name: "artist", kind: "text", label: q("Author", "Auteur") },
      { name: "copyright", kind: "text", label: q("Copyright", "Copyright"), placeholder: q("© 2026 Your Name", "© 2026 Votre nom") },
      { name: "description", kind: "textarea", label: q("Description", "Description") },
    ],
  },
  {
    id: "rename",
    title: q("Rename", "Renommer"),
    summary: q("Rename a batch from a pattern: number, date taken, camera, size, original name.", "Renommez un lot avec un modèle : numéro, date de prise de vue, appareil, taille, nom d'origine."),
    category: "metadata",
    input: "images",
    aliases: ["batch rename", "filename", "number", "sequence", "nom", "numéroter", "fichiers"],
    fields: [
      { name: "pattern", kind: "text", label: q("Pattern", "Modèle"), default: "{date}-{n}", required: true, help: q("{n} number, {name} original name, {date} {time} taken, {camera}, {w}×{h} size, {ext}.", "{n} numéro, {name} nom d'origine, {date} {time} prise de vue, {camera}, {w}×{h} taille, {ext}.") },
      { name: "start", kind: "number", label: q("First number", "Premier numéro"), min: 0, max: 999999, default: 1 },
      { name: "digits", kind: "number", label: q("Digits", "Chiffres"), min: 1, max: 8, default: 3 },
      { name: "order", kind: "select", label: q("Order", "Ordre"), default: "list", choices: [{ value: "list", label: q("As listed", "Comme dans la liste") }, { value: "date", label: q("By date taken", "Par date de prise de vue") }, { value: "name", label: q("By name", "Par nom") }] },
      { name: "case", kind: "select", label: q("Letters", "Lettres"), default: "keep", advanced: true, choices: [{ value: "keep", label: q("Unchanged", "Inchangées") }, { value: "lower", label: q("lowercase", "minuscules") }, { value: "slug", label: q("web-safe-slug", "slug-pour-le-web") }] },
    ],
  },
];
