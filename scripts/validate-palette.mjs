/**
 * Check a categorical chart palette computationally, never by eye.
 *
 *   node scripts/validate-palette.mjs "#aabbcc,#ddeeff" --surface "#fbfaf9" --mode light
 *
 * Five checks, from the data-visualisation guidance this project follows:
 *   1. Lightness band     — light L 0.43–0.77, dark L 0.48–0.67 (OKLab L)
 *   2. Chroma floor       — >= 0.1, so nothing reads as grey
 *   3. CVD separation     — adjacent pairs >= 8 ΔE under protan/deutan/tritan
 *   4. Normal-vision floor— adjacent pairs >= 15 ΔE unsimulated
 *   5. Contrast           — >= 3:1 against the surface the chart sits on
 *
 * Colour-vision simulation uses the Machado (2009) severity-1.0 matrices,
 * applied in linear sRGB.
 */
const args = process.argv.slice(2);
const hexes = (args[0] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const mode = flag("mode", "light");
const surface = flag("surface", mode === "dark" ? "#1a1a19" : "#fcfcfb");

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function toLinear(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
}

/** Björn Ottosson's OKLab, from linear sRGB. */
function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const chroma = ([, a, b]) => Math.hypot(a, b);
const deltaE = (x, y) => Math.hypot(...x.map((v, i) => v - y[i])) * 100;

const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const simulate = (lin, m) => m.map((row) => row.reduce((sum, k, i) => sum + k * lin[i], 0));

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function contrast(a, b) {
  const [x, y] = [luminance(a) + 0.05, luminance(b) + 0.05].sort((p, q) => q - p);
  return x / y;
}

const band = mode === "dark" ? [0.48, 0.67] : [0.43, 0.77];
const lins = hexes.map(toLinear);
const labs = lins.map(oklab);
const surfaceLin = toLinear(surface);
const results = [];

const outOfBand = hexes.filter((_, i) => labs[i][0] < band[0] || labs[i][0] > band[1]);
results.push([outOfBand.length === 0, "Lightness band",
  outOfBand.length ? `outside L ${band[0]}–${band[1]}: ${outOfBand.join(", ")}` : `all ${hexes.length} inside L ${band[0]}–${band[1]}`]);

const lowChroma = hexes.filter((_, i) => chroma(labs[i]) < 0.1);
results.push([lowChroma.length === 0, "Chroma floor",
  lowChroma.length ? `below 0.1: ${lowChroma.join(", ")}` : `all ${hexes.length} >= 0.1`]);

let worstCvd = { d: Infinity, label: "" };
let worstNormal = { d: Infinity, label: "" };
for (let i = 1; i < hexes.length; i++) {
  const pair = `${hexes[i - 1]}↔${hexes[i]}`;
  const dn = deltaE(labs[i - 1], labs[i]);
  if (dn < worstNormal.d) worstNormal = { d: dn, label: pair };
  for (const [name, m] of Object.entries(CVD)) {
    const d = deltaE(oklab(simulate(lins[i - 1], m)), oklab(simulate(lins[i], m)));
    if (d < worstCvd.d) worstCvd = { d, label: `${pair} (${name})` };
  }
}
results.push([worstCvd.d >= 8, "CVD separation", `worst adjacent ${worstCvd.label} ΔE ${worstCvd.d.toFixed(1)}`]);
results.push([worstNormal.d >= 15, "Normal-vision floor", `worst adjacent ${worstNormal.label} ΔE ${worstNormal.d.toFixed(1)}`]);

const lowContrast = hexes.filter((_, i) => contrast(lins[i], surfaceLin) < 3);
results.push([lowContrast.length === 0, "Contrast vs surface",
  lowContrast.length ? `below 3:1: ${lowContrast.map((h, i) => `${h} (${contrast(toLinear(h), surfaceLin).toFixed(2)})`).join(", ")}` : `all ${hexes.length} >= 3:1`]);

console.log(`\nPalette (${mode}, surface ${surface}): ${hexes.length} slots`);
for (const [ok, name, detail] of results) {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name.padEnd(22)} ${detail}`);
}
const allPass = results.every(([ok]) => ok);
console.log(allPass ? "\n  → ALL CHECKS PASS\n" : "\n  → FIX THE FAILURES ABOVE\n");
process.exit(allPass ? 0 : 1);
