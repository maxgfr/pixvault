import type { L, ToolDef } from "./types.ts";

const q = (en: string, fr: string): L => ({ en, fr });

export const POSITIONS: { value: string; label: L }[] = [
  { value: "br", label: q("Bottom right", "En bas à droite") },
  { value: "bl", label: q("Bottom left", "En bas à gauche") },
  { value: "bc", label: q("Bottom centre", "En bas au centre") },
  { value: "tr", label: q("Top right", "En haut à droite") },
  { value: "tl", label: q("Top left", "En haut à gauche") },
  { value: "tc", label: q("Top centre", "En haut au centre") },
  { value: "c", label: q("Centre", "Au centre") },
  { value: "tile", label: q("Repeated across the photo", "Répété sur toute la photo") },
];

export const brandTools: ToolDef[] = [
  {
    id: "watermark",
    title: q("Watermark", "Filigrane"),
    summary: q("Your name, a copyright line or a logo, in a corner or repeated across the photo.", "Votre nom, un copyright ou un logo, dans un coin ou répété sur la photo."),
    category: "brand",
    input: "image",
    step: true,
    output: true,
    aliases: ["copyright", "logo", "signature", "stamp", "protect", "marque", "tampon", "protéger"],
    fields: [
      { name: "kind", kind: "select", label: q("Watermark", "Filigrane"), default: "text", choices: [{ value: "text", label: q("Text", "Texte") }, { value: "image", label: q("Logo image", "Image de logo") }] },
      { name: "text", kind: "text", label: q("Text", "Texte"), default: "© ", when: { field: "kind", is: ["text"] }, help: q("{date}, {year}, {camera} and {name} are replaced per photo.", "{date}, {year}, {camera} et {name} sont remplacés pour chaque photo.") },
      { name: "logo", kind: "file", label: q("Logo (PNG with transparency is best)", "Logo (idéalement PNG transparent)"), accept: "image/*", when: { field: "kind", is: ["image"] } },
      { name: "position", kind: "select", label: q("Position", "Position"), default: "br", choices: POSITIONS },
      { name: "size", kind: "range", label: q("Size", "Taille"), min: 1, max: 60, default: 4, unit: "%" },
      { name: "opacity", kind: "range", label: q("Opacity", "Opacité"), min: 5, max: 100, default: 70, unit: "%" },
      { name: "color", kind: "color", label: q("Text colour", "Couleur du texte"), default: "#ffffff", when: { field: "kind", is: ["text"] } },
      { name: "shadow", kind: "boolean", label: q("Soft shadow for legibility", "Ombre douce pour la lisibilité"), default: true, when: { field: "kind", is: ["text"] } },
      { name: "margin", kind: "range", label: q("Distance from the edge", "Distance au bord"), min: 0, max: 20, default: 3, unit: "%", advanced: true },
      { name: "angle", kind: "range", label: q("Angle when repeated", "Angle si répété"), min: -90, max: 90, default: -30, unit: "°", advanced: true, when: { field: "position", is: ["tile"] } },
      { name: "font", kind: "select", label: q("Typeface", "Police"), default: "sans", advanced: true, when: { field: "kind", is: ["text"] }, choices: [{ value: "sans", label: q("Sans serif", "Sans empattement") }, { value: "serif", label: q("Serif", "Avec empattement") }, { value: "mono", label: q("Monospace", "Chasse fixe") }] },
    ],
  },
  {
    id: "caption",
    title: q("Caption", "Légende"),
    summary: q("Write a caption on or under each photo: free text, date, camera settings.", "Écrivez une légende sur ou sous chaque photo : texte libre, date, réglages de prise de vue."),
    category: "brand",
    input: "image",
    step: true,
    output: true,
    aliases: ["text", "label", "title", "date stamp", "exif overlay", "texte", "titre", "date"],
    fields: [
      { name: "text", kind: "textarea", label: q("Caption", "Légende"), default: "{date} · {camera}", help: q("{date}, {time}, {camera}, {lens}, {settings} (f/, s, ISO), {name} are replaced per photo.", "{date}, {time}, {camera}, {lens}, {settings} (f/, s, ISO), {name} sont remplacés pour chaque photo.") },
      { name: "place", kind: "select", label: q("Where", "Où"), default: "below", choices: [{ value: "below", label: q("In a band below", "Dans un bandeau dessous") }, { value: "over", label: q("Over the photo, at the bottom", "Sur la photo, en bas") }, { value: "top", label: q("Over the photo, at the top", "Sur la photo, en haut") }] },
      { name: "size", kind: "range", label: q("Text size", "Taille du texte"), min: 1, max: 12, step: 0.5, default: 3, unit: "%" },
      { name: "color", kind: "color", label: q("Text colour", "Couleur du texte"), default: "#1a1a1a" },
      { name: "band", kind: "color", label: q("Band colour", "Couleur du bandeau"), default: "#ffffff", when: { field: "place", is: ["below"] } },
      { name: "align", kind: "select", label: q("Alignment", "Alignement"), default: "center", advanced: true, choices: [{ value: "left", label: q("Left", "Gauche") }, { value: "center", label: q("Centre", "Centre") }, { value: "right", label: q("Right", "Droite") }] },
    ],
  },
  {
    id: "redact",
    title: q("Blur or hide areas", "Flouter ou masquer"),
    summary: q("Hide faces, number plates, addresses or screens: blur, pixelate or cover the areas you draw.", "Cachez visages, plaques, adresses ou écrans : flou, pixellisation ou aplat sur les zones dessinées."),
    category: "brand",
    input: "image",
    step: true,
    output: true,
    editor: "redact",
    aliases: ["blur", "pixelate", "censor", "hide", "anonymize", "privacy", "mosaic", "flou", "pixelliser", "censurer", "anonymiser"],
    fields: [
      { name: "style", kind: "select", label: q("Style", "Style"), default: "pixelate", choices: [{ value: "pixelate", label: q("Pixelate", "Pixelliser") }, { value: "blur", label: q("Blur", "Flouter") }, { value: "fill", label: q("Solid box", "Aplat") }] },
      { name: "strength", kind: "range", label: q("Strength", "Intensité"), min: 1, max: 100, default: 60 },
      { name: "color", kind: "color", label: q("Box colour", "Couleur de l'aplat"), default: "#000000", when: { field: "style", is: ["fill"] } },
      { name: "regions", kind: "text", label: q("Areas (x,y,w,h in %, separated by ;)", "Zones (x,y,l,h en %, séparées par ;)"), advanced: true, placeholder: q("Drawn in the editor", "Dessinées dans l'éditeur") },
    ],
  },
];
