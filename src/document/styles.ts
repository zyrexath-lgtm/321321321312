import {
  attr,
  child,
  children,
  descendants,
  type XmlDocument,
  type XmlElement,
} from "./xml";

export interface ParagraphFormat {
  line?: number;
  lineRule?: string;
  firstLine?: number;
  firstLineChars?: number;
  hanging?: number;
  hangingChars?: number;
  alignment?: string;
  numbering?: string;
  outline?: number;
  bidi?: boolean;
}
export interface RunFormat {
  font?: string;
  size?: number;
}
interface FontState {
  ascii?: string;
  hAnsi?: string;
  asciiTheme?: string;
  hAnsiTheme?: string;
}
const numberAttr = (el: XmlElement | undefined, name: string) => {
  const value = attr(el, name);
  return value === undefined ? undefined : Number(value);
};

export class StyleResolver {
  private styles = new Map<string, XmlElement>();
  private defaultParagraph?: string;
  private defaultRun?: XmlElement;
  private defaultP?: XmlElement;
  private themeFonts: Record<string, string> = {};
  private chains = new Map<string, XmlElement[]>();

  constructor(styles?: XmlDocument, theme?: XmlDocument) {
    if (styles?.documentElement) {
      const defaults = child(styles.documentElement, "docDefaults");
      this.defaultRun = child(child(defaults, "rPrDefault"), "rPr");
      this.defaultP = child(child(defaults, "pPrDefault"), "pPr");
      for (const style of children(styles.documentElement, "style")) {
        const id = attr(style, "styleId");
        if (id) {
          this.styles.set(id, style);
          if (
            attr(style, "type") === "paragraph" &&
            ["1", "true", "on"].includes(attr(style, "default") || "")
          )
            this.defaultParagraph = id;
        }
      }
    }
    if (theme) {
      for (const group of ["major", "minor"]) {
        const fonts = theme.getElementsByTagNameNS("*", `${group}Font`).item(0);
        const latin = fonts
          ?.getElementsByTagNameNS("*", "latin")
          .item(0)
          ?.getAttribute("typeface");
        if (latin)
          for (const suffix of ["Ascii", "HAnsi"])
            this.themeFonts[`${group}${suffix}`] = latin;
      }
    }
  }

  private chain(id: string | undefined): XmlElement[] {
    if (!id) return [];
    const cached = this.chains.get(id);
    if (cached) return cached;
    const chain: XmlElement[] = [],
      visited = new Set<string>();
    let current: string | undefined = id;
    while (current && !visited.has(current) && chain.length < 40) {
      visited.add(current);
      const style = this.styles.get(current);
      if (!style) break;
      chain.unshift(style);
      current = attr(child(style, "basedOn"), "val");
    }
    this.chains.set(id, chain);
    return chain;
  }

  styleId(p: XmlElement): string | undefined {
    return (
      attr(child(child(p, "pPr"), "pStyle"), "val") || this.defaultParagraph
    );
  }

  styleName(p: XmlElement): string {
    const id = this.styleId(p);
    return `${id || ""} ${attr(child(id ? this.styles.get(id) : undefined, "name"), "val") || ""}`;
  }

  paragraph(p: XmlElement, includeDirect = true): ParagraphFormat {
    const out: ParagraphFormat = {};
    const propertyLayers = [
      this.defaultP,
      ...this.chain(this.styleId(p)).map((s) => child(s, "pPr")),
      ...(includeDirect ? [child(p, "pPr")] : []),
    ];
    for (const layer of propertyLayers) {
      if (!layer) continue;
      const spacing = child(layer, "spacing"),
        indent = child(layer, "ind");
      for (const key of ["line", "lineRule"] as const) {
        const value =
          key === "line" ? numberAttr(spacing, key) : attr(spacing, key);
        if (value !== undefined) Object.assign(out, { [key]: value });
      }
      for (const key of [
        "firstLine",
        "firstLineChars",
        "hanging",
        "hangingChars",
      ] as const) {
        const value = numberAttr(indent, key);
        if (value !== undefined) out[key] = value;
      }
      const jc = attr(child(layer, "jc"), "val");
      if (jc !== undefined) out.alignment = jc;
      const num = child(layer, "numPr");
      if (num) out.numbering = attr(child(num, "numId"), "val") || "inherited";
      const outline = numberAttr(child(layer, "outlineLvl"), "val");
      if (outline !== undefined) out.outline = outline;
      const bidi = child(layer, "bidi");
      if (bidi)
        out.bidi = !["0", "false", "off"].includes(attr(bidi, "val") || "true");
    }
    return out;
  }

  run(p: XmlElement, run: XmlElement): RunFormat {
    const font: FontState = {};
    let size: number | undefined;
    const rStyle = attr(child(child(run, "rPr"), "rStyle"), "val");
    const layers = [
      this.defaultRun,
      ...this.chain(this.styleId(p)).map((s) => child(s, "rPr")),
      ...this.chain(rStyle).map((s) => child(s, "rPr")),
      child(run, "rPr"),
    ];
    for (const layer of layers) {
      if (!layer) continue;
      const fonts = child(layer, "rFonts");
      for (const key of [
        "ascii",
        "hAnsi",
        "asciiTheme",
        "hAnsiTheme",
      ] as const) {
        const value = attr(fonts, key);
        if (value !== undefined) font[key] = value;
      }
      for (const key of ["ascii", "hAnsi"] as const) {
        if (
          attr(fonts, key) !== undefined &&
          attr(fonts, `${key}Theme`) === undefined
        )
          delete font[`${key}Theme`];
        if (attr(fonts, `${key}Theme`) !== undefined) delete font[key];
      }
      const value = numberAttr(child(layer, "sz"), "val");
      if (value !== undefined) size = value / 2;
    }
    const ascii = font.asciiTheme
      ? this.themeFonts[font.asciiTheme]
      : font.ascii;
    const hAnsi = font.hAnsiTheme
      ? this.themeFonts[font.hAnsiTheme]
      : font.hAnsi;
    const fonts = [
      ...new Set([
        ascii || "Шрифт по умолчанию Word",
        hAnsi || "Шрифт по умолчанию Word",
      ]),
    ];
    return { font: fonts.join(" / "), size };
  }
}

export function hasComplexContent(p: XmlElement): boolean {
  const unsafe = new Set([
    "fldChar",
    "fldSimple",
    "instrText",
    "ins",
    "del",
    "moveFrom",
    "moveTo",
    "pPrChange",
    "rPrChange",
    "drawing",
    "pict",
    "object",
    "sdt",
    "altChunk",
    "hyperlinkChange",
    "rtl",
    "cs",
  ]);
  return (
    descendants(p).some(
      (el) =>
        unsafe.has(el.localName || "") ||
        el.localName === "oMath" ||
        el.localName === "oMathPara",
    ) ||
    (() => {
      // Equations use their own namespace and must remain completely untouched.
      const stack = [p];
      while (stack.length) {
        const node = stack.pop()!;
        for (let n = node.firstChild; n; n = n.nextSibling)
          if (n.nodeType === 1) {
            const e = n as XmlElement;
            if (
              e.localName === "oMath" ||
              e.localName === "oMathPara" ||
              e.localName === "AlternateContent"
            )
              return true;
            stack.push(e);
          }
      }
      return false;
    })()
  );
}
