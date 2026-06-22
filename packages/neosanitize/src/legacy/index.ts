/**
 * sanitize-html: zero-dependency TypeScript rewrite.
 * Public API matches the original (apostrophecms/sanitize-html).
 */

// =============================================================================
// Public types
// =============================================================================

export type Attributes = Record<string, string>;

export interface AllowedAttributeObject {
  name: string;
  multiple?: boolean;
  values: string[];
}

export type AllowedAttribute = string | AllowedAttributeObject;

export type DisallowedTagsMode =
  | 'discard'
  | 'escape'
  | 'recursiveEscape'
  | 'completelyDiscard';

export interface IFrame {
  tag: string;
  attribs: Attributes;
  text: string;
  tagPosition: number;
  mediaChildren: string[];
  /** Set by transformTags when the transformer returns `text`. */
  innerText?: string;
  /** Set when the transformer changed the tag name. */
  name?: string;
}

export interface TransformResult {
  tagName: string;
  attribs: Attributes;
  text?: string;
}

export type Transformer = (
  tagName: string,
  attribs: Attributes
) => TransformResult;

export interface ParserOptions {
  decodeEntities?: boolean;
  lowerCaseTags?: boolean;
  lowerCaseAttributeNames?: boolean;
}

export interface AllowedStyles {
  [tagOrStar: string]: { [property: string]: RegExp[] };
}

export interface IOptions {
  allowedTags?: string[] | false | null;
  disallowedTagsMode?: DisallowedTagsMode;
  allowedAttributes?: Record<string, AllowedAttribute[]> | false | null;
  allowedClasses?: Record<string, Array<string | RegExp> | false>;
  allowedStyles?: AllowedStyles;
  allowedSchemes?: string[];
  allowedSchemesByTag?: Record<string, string[]>;
  allowedSchemesAppliedToAttributes?: string[];
  allowProtocolRelative?: boolean;
  allowedIframeHostnames?: string[];
  allowedIframeDomains?: string[];
  allowIframeRelativeUrls?: boolean;
  allowedScriptHostnames?: string[];
  allowedScriptDomains?: string[];
  allowVulnerableTags?: boolean;
  enforceHtmlBoundary?: boolean;
  parseStyleAttributes?: boolean;
  preserveEscapedAttributes?: boolean;
  selfClosing?: string[];
  nonTextTags?: string[];
  nonBooleanAttributes?: string[];
  allowedEmptyAttributes?: string[];
  transformTags?: Record<string, string | Transformer>;
  textFilter?: (text: string, tagName?: string) => string;
  exclusiveFilter?: (frame: IFrame) => boolean | 'excludeTag';
  onOpenTag?: (name: string, attribs: Attributes) => void;
  onCloseTag?: (name: string, isImplied: boolean) => void;
  nestingLimit?: number;
  parser?: ParserOptions;
}

export interface Defaults {
  allowedTags: string[];
  nonBooleanAttributes: string[];
  disallowedTagsMode: DisallowedTagsMode;
  allowedAttributes: Record<string, AllowedAttribute[]>;
  allowedEmptyAttributes: string[];
  selfClosing: string[];
  allowedSchemes: string[];
  allowedSchemesByTag: Record<string, string[]>;
  allowedSchemesAppliedToAttributes: string[];
  allowProtocolRelative: boolean;
  enforceHtmlBoundary: boolean;
  parseStyleAttributes: boolean;
  preserveEscapedAttributes: boolean;
}

export interface SanitizeHtml {
  (
    html: string | number | null | undefined,
    options?: IOptions,
    _recursing?: boolean
  ): string;
  defaults: Defaults;
  simpleTransform: (
    newTagName: string,
    newAttribs?: Attributes,
    merge?: boolean
  ) => Transformer;
}

// =============================================================================
// Small helpers
// =============================================================================

function escapeStringRegexp(s: string): string {
  return s.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
}

function isPlainObject(obj: unknown): obj is Record<string, unknown> {
  if (obj === null || typeof obj !== 'object') return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === null || proto === Object.prototype;
}

function deepmerge<A, B>(a: A, b: B): A | B | (A & B) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return (a as unknown[]).concat(b as unknown[]) as unknown as A & B;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(a as object)) out[k] = (a as Record<string, unknown>)[k];
    for (const k of Object.keys(b as object)) {
      if (k in out) out[k] = deepmerge(out[k], (b as Record<string, unknown>)[k]);
      else out[k] = (b as Record<string, unknown>)[k];
    }
    return out as unknown as A & B;
  }
  return (b === undefined ? a : b) as A | B;
}

function each<T>(
  obj: Record<string, T> | undefined | null,
  cb: (value: T, key: string) => void
): void {
  if (obj) {
    Object.keys(obj).forEach((key) => cb(obj[key], key));
  }
}

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function filter<T>(a: T[], cb: (v: T) => boolean): T[] {
  const n: T[] = [];
  for (const v of a) if (cb(v)) n.push(v);
  return n;
}

function isEmptyObject(obj: object): boolean {
  for (const key in obj) {
    if (has(obj, key)) return false;
  }
  return true;
}

// =============================================================================
// HTML entity decoding
// =============================================================================

// The full WHATWG HTML5 named character reference table lives inline below so
// the library stays a single zero-dependency, isomorphic file. Regenerate with
// `node scripts/gen-entities.mjs` (rewrites the block between the markers).
// <generated-entities> — do not edit by hand
// Full WHATWG HTML5 named character reference table: 2231 entries
// (106 legacy no-semicolon forms). Source: scripts/entities-whatwg.json.
// A Map built from a JSON.parse()'d pair array — fast cold start + fast lookups.
/** Longest entity name in letters (excluding any trailing ";"). */
const MAX_ENTITY_NAME_LENGTH = 31;
const NAMED_ENTITIES: Map<string, string> = new Map(JSON.parse(
  '[["AElig","Æ"],["AElig;","Æ"],["AMP","&"],["AMP;","&"],["Aacute","Á"],["Aacute;","Á"],["Abreve;","Ă"],["Acirc","Â"],["Acirc;","Â"],["Acy;","А"],["Afr;","𝔄"],["Agrave","À"],["Agrave;","À"],["Alpha;","Α"],["Amacr;","Ā"],["And;","⩓"],["Aogon;","Ą"],["Aopf;","𝔸"],["ApplyFunction;","⁡"],["Aring","Å"],["Aring;","Å"],["Ascr;","𝒜"],["Assign;","≔"],["Atilde","Ã"],["Atilde;","Ã"],["Auml","Ä"],["Auml;","Ä"],["Backslash;","∖"],["Barv;","⫧"],["Barwed;","⌆"],["Bcy;","Б"],["Because;","∵"],["Bernoullis;","ℬ"],["Beta;","Β"],["Bfr;","𝔅"],["Bopf;","𝔹"],["Breve;","˘"],["Bscr;","ℬ"],["Bumpeq;","≎"],["CHcy;","Ч"],["COPY","©"],["COPY;","©"],["Cacute;","Ć"],["Cap;","⋒"],["CapitalDifferentialD;","ⅅ"],["Cayleys;","ℭ"],["Ccaron;","Č"],["Ccedil","Ç"],["Ccedil;","Ç"],["Ccirc;","Ĉ"],["Cconint;","∰"],["Cdot;","Ċ"],["Cedilla;","¸"],["CenterDot;","·"],["Cfr;","ℭ"],["Chi;","Χ"],["CircleDot;","⊙"],["CircleMinus;","⊖"],["CirclePlus;","⊕"],["CircleTimes;","⊗"],["ClockwiseContourIntegral;","∲"],["CloseCurlyDoubleQuote;","”"],["CloseCurlyQuote;","’"],["Colon;","∷"],["Colone;","⩴"],["Congruent;","≡"],["Conint;","∯"],["ContourIntegral;","∮"],["Copf;","ℂ"],["Coproduct;","∐"],["CounterClockwiseContourIntegral;","∳"],["Cross;","⨯"],["Cscr;","𝒞"],["Cup;","⋓"],["CupCap;","≍"],["DD;","ⅅ"],["DDotrahd;","⤑"],["DJcy;","Ђ"],["DScy;","Ѕ"],["DZcy;","Џ"],["Dagger;","‡"],["Darr;","↡"],["Dashv;","⫤"],["Dcaron;","Ď"],["Dcy;","Д"],["Del;","∇"],["Delta;","Δ"],["Dfr;","𝔇"],["DiacriticalAcute;","´"],["DiacriticalDot;","˙"],["DiacriticalDoubleAcute;","˝"],["DiacriticalGrave;","`"],["DiacriticalTilde;","˜"],["Diamond;","⋄"],["DifferentialD;","ⅆ"],["Dopf;","𝔻"],["Dot;","¨"],["DotDot;","⃜"],["DotEqual;","≐"],["DoubleContourIntegral;","∯"],["DoubleDot;","¨"],["DoubleDownArrow;","⇓"],["DoubleLeftArrow;","⇐"],["DoubleLeftRightArrow;","⇔"],["DoubleLeftTee;","⫤"],["DoubleLongLeftArrow;","⟸"],["DoubleLongLeftRightArrow;","⟺"],["DoubleLongRightArrow;","⟹"],["DoubleRightArrow;","⇒"],["DoubleRightTee;","⊨"],["DoubleUpArrow;","⇑"],["DoubleUpDownArrow;","⇕"],["DoubleVerticalBar;","∥"],["DownArrow;","↓"],["DownArrowBar;","⤓"],["DownArrowUpArrow;","⇵"],["DownBreve;","̑"],["DownLeftRightVector;","⥐"],["DownLeftTeeVector;","⥞"],["DownLeftVector;","↽"],["DownLeftVectorBar;","⥖"],["DownRightTeeVector;","⥟"],["DownRightVector;","⇁"],["DownRightVectorBar;","⥗"],["DownTee;","⊤"],["DownTeeArrow;","↧"],["Downarrow;","⇓"],["Dscr;","𝒟"],["Dstrok;","Đ"],["ENG;","Ŋ"],["ETH","Ð"],["ETH;","Ð"],["Eacute","É"],["Eacute;","É"],["Ecaron;","Ě"],["Ecirc","Ê"],["Ecirc;","Ê"],["Ecy;","Э"],["Edot;","Ė"],["Efr;","𝔈"],["Egrave","È"],["Egrave;","È"],["Element;","∈"],["Emacr;","Ē"],["EmptySmallSquare;","◻"],["EmptyVerySmallSquare;","▫"],["Eogon;","Ę"],["Eopf;","𝔼"],["Epsilon;","Ε"],["Equal;","⩵"],["EqualTilde;","≂"],["Equilibrium;","⇌"],["Escr;","ℰ"],["Esim;","⩳"],["Eta;","Η"],["Euml","Ë"],["Euml;","Ë"],["Exists;","∃"],["ExponentialE;","ⅇ"],["Fcy;","Ф"],["Ffr;","𝔉"],["FilledSmallSquare;","◼"],["FilledVerySmallSquare;","▪"],["Fopf;","𝔽"],["ForAll;","∀"],["Fouriertrf;","ℱ"],["Fscr;","ℱ"],["GJcy;","Ѓ"],["GT",">"],["GT;",">"],["Gamma;","Γ"],["Gammad;","Ϝ"],["Gbreve;","Ğ"],["Gcedil;","Ģ"],["Gcirc;","Ĝ"],["Gcy;","Г"],["Gdot;","Ġ"],["Gfr;","𝔊"],["Gg;","⋙"],["Gopf;","𝔾"],["GreaterEqual;","≥"],["GreaterEqualLess;","⋛"],["GreaterFullEqual;","≧"],["GreaterGreater;","⪢"],["GreaterLess;","≷"],["GreaterSlantEqual;","⩾"],["GreaterTilde;","≳"],["Gscr;","𝒢"],["Gt;","≫"],["HARDcy;","Ъ"],["Hacek;","ˇ"],["Hat;","^"],["Hcirc;","Ĥ"],["Hfr;","ℌ"],["HilbertSpace;","ℋ"],["Hopf;","ℍ"],["HorizontalLine;","─"],["Hscr;","ℋ"],["Hstrok;","Ħ"],["HumpDownHump;","≎"],["HumpEqual;","≏"],["IEcy;","Е"],["IJlig;","Ĳ"],["IOcy;","Ё"],["Iacute","Í"],["Iacute;","Í"],["Icirc","Î"],["Icirc;","Î"],["Icy;","И"],["Idot;","İ"],["Ifr;","ℑ"],["Igrave","Ì"],["Igrave;","Ì"],["Im;","ℑ"],["Imacr;","Ī"],["ImaginaryI;","ⅈ"],["Implies;","⇒"],["Int;","∬"],["Integral;","∫"],["Intersection;","⋂"],["InvisibleComma;","⁣"],["InvisibleTimes;","⁢"],["Iogon;","Į"],["Iopf;","𝕀"],["Iota;","Ι"],["Iscr;","ℐ"],["Itilde;","Ĩ"],["Iukcy;","І"],["Iuml","Ï"],["Iuml;","Ï"],["Jcirc;","Ĵ"],["Jcy;","Й"],["Jfr;","𝔍"],["Jopf;","𝕁"],["Jscr;","𝒥"],["Jsercy;","Ј"],["Jukcy;","Є"],["KHcy;","Х"],["KJcy;","Ќ"],["Kappa;","Κ"],["Kcedil;","Ķ"],["Kcy;","К"],["Kfr;","𝔎"],["Kopf;","𝕂"],["Kscr;","𝒦"],["LJcy;","Љ"],["LT","<"],["LT;","<"],["Lacute;","Ĺ"],["Lambda;","Λ"],["Lang;","⟪"],["Laplacetrf;","ℒ"],["Larr;","↞"],["Lcaron;","Ľ"],["Lcedil;","Ļ"],["Lcy;","Л"],["LeftAngleBracket;","⟨"],["LeftArrow;","←"],["LeftArrowBar;","⇤"],["LeftArrowRightArrow;","⇆"],["LeftCeiling;","⌈"],["LeftDoubleBracket;","⟦"],["LeftDownTeeVector;","⥡"],["LeftDownVector;","⇃"],["LeftDownVectorBar;","⥙"],["LeftFloor;","⌊"],["LeftRightArrow;","↔"],["LeftRightVector;","⥎"],["LeftTee;","⊣"],["LeftTeeArrow;","↤"],["LeftTeeVector;","⥚"],["LeftTriangle;","⊲"],["LeftTriangleBar;","⧏"],["LeftTriangleEqual;","⊴"],["LeftUpDownVector;","⥑"],["LeftUpTeeVector;","⥠"],["LeftUpVector;","↿"],["LeftUpVectorBar;","⥘"],["LeftVector;","↼"],["LeftVectorBar;","⥒"],["Leftarrow;","⇐"],["Leftrightarrow;","⇔"],["LessEqualGreater;","⋚"],["LessFullEqual;","≦"],["LessGreater;","≶"],["LessLess;","⪡"],["LessSlantEqual;","⩽"],["LessTilde;","≲"],["Lfr;","𝔏"],["Ll;","⋘"],["Lleftarrow;","⇚"],["Lmidot;","Ŀ"],["LongLeftArrow;","⟵"],["LongLeftRightArrow;","⟷"],["LongRightArrow;","⟶"],["Longleftarrow;","⟸"],["Longleftrightarrow;","⟺"],["Longrightarrow;","⟹"],["Lopf;","𝕃"],["LowerLeftArrow;","↙"],["LowerRightArrow;","↘"],["Lscr;","ℒ"],["Lsh;","↰"],["Lstrok;","Ł"],["Lt;","≪"],["Map;","⤅"],["Mcy;","М"],["MediumSpace;"," "],["Mellintrf;","ℳ"],["Mfr;","𝔐"],["MinusPlus;","∓"],["Mopf;","𝕄"],["Mscr;","ℳ"],["Mu;","Μ"],["NJcy;","Њ"],["Nacute;","Ń"],["Ncaron;","Ň"],["Ncedil;","Ņ"],["Ncy;","Н"],["NegativeMediumSpace;","​"],["NegativeThickSpace;","​"],["NegativeThinSpace;","​"],["NegativeVeryThinSpace;","​"],["NestedGreaterGreater;","≫"],["NestedLessLess;","≪"],["NewLine;","\\n"],["Nfr;","𝔑"],["NoBreak;","⁠"],["NonBreakingSpace;"," "],["Nopf;","ℕ"],["Not;","⫬"],["NotCongruent;","≢"],["NotCupCap;","≭"],["NotDoubleVerticalBar;","∦"],["NotElement;","∉"],["NotEqual;","≠"],["NotEqualTilde;","≂̸"],["NotExists;","∄"],["NotGreater;","≯"],["NotGreaterEqual;","≱"],["NotGreaterFullEqual;","≧̸"],["NotGreaterGreater;","≫̸"],["NotGreaterLess;","≹"],["NotGreaterSlantEqual;","⩾̸"],["NotGreaterTilde;","≵"],["NotHumpDownHump;","≎̸"],["NotHumpEqual;","≏̸"],["NotLeftTriangle;","⋪"],["NotLeftTriangleBar;","⧏̸"],["NotLeftTriangleEqual;","⋬"],["NotLess;","≮"],["NotLessEqual;","≰"],["NotLessGreater;","≸"],["NotLessLess;","≪̸"],["NotLessSlantEqual;","⩽̸"],["NotLessTilde;","≴"],["NotNestedGreaterGreater;","⪢̸"],["NotNestedLessLess;","⪡̸"],["NotPrecedes;","⊀"],["NotPrecedesEqual;","⪯̸"],["NotPrecedesSlantEqual;","⋠"],["NotReverseElement;","∌"],["NotRightTriangle;","⋫"],["NotRightTriangleBar;","⧐̸"],["NotRightTriangleEqual;","⋭"],["NotSquareSubset;","⊏̸"],["NotSquareSubsetEqual;","⋢"],["NotSquareSuperset;","⊐̸"],["NotSquareSupersetEqual;","⋣"],["NotSubset;","⊂⃒"],["NotSubsetEqual;","⊈"],["NotSucceeds;","⊁"],["NotSucceedsEqual;","⪰̸"],["NotSucceedsSlantEqual;","⋡"],["NotSucceedsTilde;","≿̸"],["NotSuperset;","⊃⃒"],["NotSupersetEqual;","⊉"],["NotTilde;","≁"],["NotTildeEqual;","≄"],["NotTildeFullEqual;","≇"],["NotTildeTilde;","≉"],["NotVerticalBar;","∤"],["Nscr;","𝒩"],["Ntilde","Ñ"],["Ntilde;","Ñ"],["Nu;","Ν"],["OElig;","Œ"],["Oacute","Ó"],["Oacute;","Ó"],["Ocirc","Ô"],["Ocirc;","Ô"],["Ocy;","О"],["Odblac;","Ő"],["Ofr;","𝔒"],["Ograve","Ò"],["Ograve;","Ò"],["Omacr;","Ō"],["Omega;","Ω"],["Omicron;","Ο"],["Oopf;","𝕆"],["OpenCurlyDoubleQuote;","“"],["OpenCurlyQuote;","‘"],["Or;","⩔"],["Oscr;","𝒪"],["Oslash","Ø"],["Oslash;","Ø"],["Otilde","Õ"],["Otilde;","Õ"],["Otimes;","⨷"],["Ouml","Ö"],["Ouml;","Ö"],["OverBar;","‾"],["OverBrace;","⏞"],["OverBracket;","⎴"],["OverParenthesis;","⏜"],["PartialD;","∂"],["Pcy;","П"],["Pfr;","𝔓"],["Phi;","Φ"],["Pi;","Π"],["PlusMinus;","±"],["Poincareplane;","ℌ"],["Popf;","ℙ"],["Pr;","⪻"],["Precedes;","≺"],["PrecedesEqual;","⪯"],["PrecedesSlantEqual;","≼"],["PrecedesTilde;","≾"],["Prime;","″"],["Product;","∏"],["Proportion;","∷"],["Proportional;","∝"],["Pscr;","𝒫"],["Psi;","Ψ"],["QUOT","\\""],["QUOT;","\\""],["Qfr;","𝔔"],["Qopf;","ℚ"],["Qscr;","𝒬"],["RBarr;","⤐"],["REG","®"],["REG;","®"],["Racute;","Ŕ"],["Rang;","⟫"],["Rarr;","↠"],["Rarrtl;","⤖"],["Rcaron;","Ř"],["Rcedil;","Ŗ"],["Rcy;","Р"],["Re;","ℜ"],["ReverseElement;","∋"],["ReverseEquilibrium;","⇋"],["ReverseUpEquilibrium;","⥯"],["Rfr;","ℜ"],["Rho;","Ρ"],["RightAngleBracket;","⟩"],["RightArrow;","→"],["RightArrowBar;","⇥"],["RightArrowLeftArrow;","⇄"],["RightCeiling;","⌉"],["RightDoubleBracket;","⟧"],["RightDownTeeVector;","⥝"],["RightDownVector;","⇂"],["RightDownVectorBar;","⥕"],["RightFloor;","⌋"],["RightTee;","⊢"],["RightTeeArrow;","↦"],["RightTeeVector;","⥛"],["RightTriangle;","⊳"],["RightTriangleBar;","⧐"],["RightTriangleEqual;","⊵"],["RightUpDownVector;","⥏"],["RightUpTeeVector;","⥜"],["RightUpVector;","↾"],["RightUpVectorBar;","⥔"],["RightVector;","⇀"],["RightVectorBar;","⥓"],["Rightarrow;","⇒"],["Ropf;","ℝ"],["RoundImplies;","⥰"],["Rrightarrow;","⇛"],["Rscr;","ℛ"],["Rsh;","↱"],["RuleDelayed;","⧴"],["SHCHcy;","Щ"],["SHcy;","Ш"],["SOFTcy;","Ь"],["Sacute;","Ś"],["Sc;","⪼"],["Scaron;","Š"],["Scedil;","Ş"],["Scirc;","Ŝ"],["Scy;","С"],["Sfr;","𝔖"],["ShortDownArrow;","↓"],["ShortLeftArrow;","←"],["ShortRightArrow;","→"],["ShortUpArrow;","↑"],["Sigma;","Σ"],["SmallCircle;","∘"],["Sopf;","𝕊"],["Sqrt;","√"],["Square;","□"],["SquareIntersection;","⊓"],["SquareSubset;","⊏"],["SquareSubsetEqual;","⊑"],["SquareSuperset;","⊐"],["SquareSupersetEqual;","⊒"],["SquareUnion;","⊔"],["Sscr;","𝒮"],["Star;","⋆"],["Sub;","⋐"],["Subset;","⋐"],["SubsetEqual;","⊆"],["Succeeds;","≻"],["SucceedsEqual;","⪰"],["SucceedsSlantEqual;","≽"],["SucceedsTilde;","≿"],["SuchThat;","∋"],["Sum;","∑"],["Sup;","⋑"],["Superset;","⊃"],["SupersetEqual;","⊇"],["Supset;","⋑"],["THORN","Þ"],["THORN;","Þ"],["TRADE;","™"],["TSHcy;","Ћ"],["TScy;","Ц"],["Tab;","\\t"],["Tau;","Τ"],["Tcaron;","Ť"],["Tcedil;","Ţ"],["Tcy;","Т"],["Tfr;","𝔗"],["Therefore;","∴"],["Theta;","Θ"],["ThickSpace;","  "],["ThinSpace;"," "],["Tilde;","∼"],["TildeEqual;","≃"],["TildeFullEqual;","≅"],["TildeTilde;","≈"],["Topf;","𝕋"],["TripleDot;","⃛"],["Tscr;","𝒯"],["Tstrok;","Ŧ"],["Uacute","Ú"],["Uacute;","Ú"],["Uarr;","↟"],["Uarrocir;","⥉"],["Ubrcy;","Ў"],["Ubreve;","Ŭ"],["Ucirc","Û"],["Ucirc;","Û"],["Ucy;","У"],["Udblac;","Ű"],["Ufr;","𝔘"],["Ugrave","Ù"],["Ugrave;","Ù"],["Umacr;","Ū"],["UnderBar;","_"],["UnderBrace;","⏟"],["UnderBracket;","⎵"],["UnderParenthesis;","⏝"],["Union;","⋃"],["UnionPlus;","⊎"],["Uogon;","Ų"],["Uopf;","𝕌"],["UpArrow;","↑"],["UpArrowBar;","⤒"],["UpArrowDownArrow;","⇅"],["UpDownArrow;","↕"],["UpEquilibrium;","⥮"],["UpTee;","⊥"],["UpTeeArrow;","↥"],["Uparrow;","⇑"],["Updownarrow;","⇕"],["UpperLeftArrow;","↖"],["UpperRightArrow;","↗"],["Upsi;","ϒ"],["Upsilon;","Υ"],["Uring;","Ů"],["Uscr;","𝒰"],["Utilde;","Ũ"],["Uuml","Ü"],["Uuml;","Ü"],["VDash;","⊫"],["Vbar;","⫫"],["Vcy;","В"],["Vdash;","⊩"],["Vdashl;","⫦"],["Vee;","⋁"],["Verbar;","‖"],["Vert;","‖"],["VerticalBar;","∣"],["VerticalLine;","|"],["VerticalSeparator;","❘"],["VerticalTilde;","≀"],["VeryThinSpace;"," "],["Vfr;","𝔙"],["Vopf;","𝕍"],["Vscr;","𝒱"],["Vvdash;","⊪"],["Wcirc;","Ŵ"],["Wedge;","⋀"],["Wfr;","𝔚"],["Wopf;","𝕎"],["Wscr;","𝒲"],["Xfr;","𝔛"],["Xi;","Ξ"],["Xopf;","𝕏"],["Xscr;","𝒳"],["YAcy;","Я"],["YIcy;","Ї"],["YUcy;","Ю"],["Yacute","Ý"],["Yacute;","Ý"],["Ycirc;","Ŷ"],["Ycy;","Ы"],["Yfr;","𝔜"],["Yopf;","𝕐"],["Yscr;","𝒴"],["Yuml;","Ÿ"],["ZHcy;","Ж"],["Zacute;","Ź"],["Zcaron;","Ž"],["Zcy;","З"],["Zdot;","Ż"],["ZeroWidthSpace;","​"],["Zeta;","Ζ"],["Zfr;","ℨ"],["Zopf;","ℤ"],["Zscr;","𝒵"],["aacute","á"],["aacute;","á"],["abreve;","ă"],["ac;","∾"],["acE;","∾̳"],["acd;","∿"],["acirc","â"],["acirc;","â"],["acute","´"],["acute;","´"],["acy;","а"],["aelig","æ"],["aelig;","æ"],["af;","⁡"],["afr;","𝔞"],["agrave","à"],["agrave;","à"],["alefsym;","ℵ"],["aleph;","ℵ"],["alpha;","α"],["amacr;","ā"],["amalg;","⨿"],["amp","&"],["amp;","&"],["and;","∧"],["andand;","⩕"],["andd;","⩜"],["andslope;","⩘"],["andv;","⩚"],["ang;","∠"],["ange;","⦤"],["angle;","∠"],["angmsd;","∡"],["angmsdaa;","⦨"],["angmsdab;","⦩"],["angmsdac;","⦪"],["angmsdad;","⦫"],["angmsdae;","⦬"],["angmsdaf;","⦭"],["angmsdag;","⦮"],["angmsdah;","⦯"],["angrt;","∟"],["angrtvb;","⊾"],["angrtvbd;","⦝"],["angsph;","∢"],["angst;","Å"],["angzarr;","⍼"],["aogon;","ą"],["aopf;","𝕒"],["ap;","≈"],["apE;","⩰"],["apacir;","⩯"],["ape;","≊"],["apid;","≋"],["apos;","\'"],["approx;","≈"],["approxeq;","≊"],["aring","å"],["aring;","å"],["ascr;","𝒶"],["ast;","*"],["asymp;","≈"],["asympeq;","≍"],["atilde","ã"],["atilde;","ã"],["auml","ä"],["auml;","ä"],["awconint;","∳"],["awint;","⨑"],["bNot;","⫭"],["backcong;","≌"],["backepsilon;","϶"],["backprime;","‵"],["backsim;","∽"],["backsimeq;","⋍"],["barvee;","⊽"],["barwed;","⌅"],["barwedge;","⌅"],["bbrk;","⎵"],["bbrktbrk;","⎶"],["bcong;","≌"],["bcy;","б"],["bdquo;","„"],["becaus;","∵"],["because;","∵"],["bemptyv;","⦰"],["bepsi;","϶"],["bernou;","ℬ"],["beta;","β"],["beth;","ℶ"],["between;","≬"],["bfr;","𝔟"],["bigcap;","⋂"],["bigcirc;","◯"],["bigcup;","⋃"],["bigodot;","⨀"],["bigoplus;","⨁"],["bigotimes;","⨂"],["bigsqcup;","⨆"],["bigstar;","★"],["bigtriangledown;","▽"],["bigtriangleup;","△"],["biguplus;","⨄"],["bigvee;","⋁"],["bigwedge;","⋀"],["bkarow;","⤍"],["blacklozenge;","⧫"],["blacksquare;","▪"],["blacktriangle;","▴"],["blacktriangledown;","▾"],["blacktriangleleft;","◂"],["blacktriangleright;","▸"],["blank;","␣"],["blk12;","▒"],["blk14;","░"],["blk34;","▓"],["block;","█"],["bne;","=⃥"],["bnequiv;","≡⃥"],["bnot;","⌐"],["bopf;","𝕓"],["bot;","⊥"],["bottom;","⊥"],["bowtie;","⋈"],["boxDL;","╗"],["boxDR;","╔"],["boxDl;","╖"],["boxDr;","╓"],["boxH;","═"],["boxHD;","╦"],["boxHU;","╩"],["boxHd;","╤"],["boxHu;","╧"],["boxUL;","╝"],["boxUR;","╚"],["boxUl;","╜"],["boxUr;","╙"],["boxV;","║"],["boxVH;","╬"],["boxVL;","╣"],["boxVR;","╠"],["boxVh;","╫"],["boxVl;","╢"],["boxVr;","╟"],["boxbox;","⧉"],["boxdL;","╕"],["boxdR;","╒"],["boxdl;","┐"],["boxdr;","┌"],["boxh;","─"],["boxhD;","╥"],["boxhU;","╨"],["boxhd;","┬"],["boxhu;","┴"],["boxminus;","⊟"],["boxplus;","⊞"],["boxtimes;","⊠"],["boxuL;","╛"],["boxuR;","╘"],["boxul;","┘"],["boxur;","└"],["boxv;","│"],["boxvH;","╪"],["boxvL;","╡"],["boxvR;","╞"],["boxvh;","┼"],["boxvl;","┤"],["boxvr;","├"],["bprime;","‵"],["breve;","˘"],["brvbar","¦"],["brvbar;","¦"],["bscr;","𝒷"],["bsemi;","⁏"],["bsim;","∽"],["bsime;","⋍"],["bsol;","\\\\"],["bsolb;","⧅"],["bsolhsub;","⟈"],["bull;","•"],["bullet;","•"],["bump;","≎"],["bumpE;","⪮"],["bumpe;","≏"],["bumpeq;","≏"],["cacute;","ć"],["cap;","∩"],["capand;","⩄"],["capbrcup;","⩉"],["capcap;","⩋"],["capcup;","⩇"],["capdot;","⩀"],["caps;","∩︀"],["caret;","⁁"],["caron;","ˇ"],["ccaps;","⩍"],["ccaron;","č"],["ccedil","ç"],["ccedil;","ç"],["ccirc;","ĉ"],["ccups;","⩌"],["ccupssm;","⩐"],["cdot;","ċ"],["cedil","¸"],["cedil;","¸"],["cemptyv;","⦲"],["cent","¢"],["cent;","¢"],["centerdot;","·"],["cfr;","𝔠"],["chcy;","ч"],["check;","✓"],["checkmark;","✓"],["chi;","χ"],["cir;","○"],["cirE;","⧃"],["circ;","ˆ"],["circeq;","≗"],["circlearrowleft;","↺"],["circlearrowright;","↻"],["circledR;","®"],["circledS;","Ⓢ"],["circledast;","⊛"],["circledcirc;","⊚"],["circleddash;","⊝"],["cire;","≗"],["cirfnint;","⨐"],["cirmid;","⫯"],["cirscir;","⧂"],["clubs;","♣"],["clubsuit;","♣"],["colon;",":"],["colone;","≔"],["coloneq;","≔"],["comma;",","],["commat;","@"],["comp;","∁"],["compfn;","∘"],["complement;","∁"],["complexes;","ℂ"],["cong;","≅"],["congdot;","⩭"],["conint;","∮"],["copf;","𝕔"],["coprod;","∐"],["copy","©"],["copy;","©"],["copysr;","℗"],["crarr;","↵"],["cross;","✗"],["cscr;","𝒸"],["csub;","⫏"],["csube;","⫑"],["csup;","⫐"],["csupe;","⫒"],["ctdot;","⋯"],["cudarrl;","⤸"],["cudarrr;","⤵"],["cuepr;","⋞"],["cuesc;","⋟"],["cularr;","↶"],["cularrp;","⤽"],["cup;","∪"],["cupbrcap;","⩈"],["cupcap;","⩆"],["cupcup;","⩊"],["cupdot;","⊍"],["cupor;","⩅"],["cups;","∪︀"],["curarr;","↷"],["curarrm;","⤼"],["curlyeqprec;","⋞"],["curlyeqsucc;","⋟"],["curlyvee;","⋎"],["curlywedge;","⋏"],["curren","¤"],["curren;","¤"],["curvearrowleft;","↶"],["curvearrowright;","↷"],["cuvee;","⋎"],["cuwed;","⋏"],["cwconint;","∲"],["cwint;","∱"],["cylcty;","⌭"],["dArr;","⇓"],["dHar;","⥥"],["dagger;","†"],["daleth;","ℸ"],["darr;","↓"],["dash;","‐"],["dashv;","⊣"],["dbkarow;","⤏"],["dblac;","˝"],["dcaron;","ď"],["dcy;","д"],["dd;","ⅆ"],["ddagger;","‡"],["ddarr;","⇊"],["ddotseq;","⩷"],["deg","°"],["deg;","°"],["delta;","δ"],["demptyv;","⦱"],["dfisht;","⥿"],["dfr;","𝔡"],["dharl;","⇃"],["dharr;","⇂"],["diam;","⋄"],["diamond;","⋄"],["diamondsuit;","♦"],["diams;","♦"],["die;","¨"],["digamma;","ϝ"],["disin;","⋲"],["div;","÷"],["divide","÷"],["divide;","÷"],["divideontimes;","⋇"],["divonx;","⋇"],["djcy;","ђ"],["dlcorn;","⌞"],["dlcrop;","⌍"],["dollar;","$"],["dopf;","𝕕"],["dot;","˙"],["doteq;","≐"],["doteqdot;","≑"],["dotminus;","∸"],["dotplus;","∔"],["dotsquare;","⊡"],["doublebarwedge;","⌆"],["downarrow;","↓"],["downdownarrows;","⇊"],["downharpoonleft;","⇃"],["downharpoonright;","⇂"],["drbkarow;","⤐"],["drcorn;","⌟"],["drcrop;","⌌"],["dscr;","𝒹"],["dscy;","ѕ"],["dsol;","⧶"],["dstrok;","đ"],["dtdot;","⋱"],["dtri;","▿"],["dtrif;","▾"],["duarr;","⇵"],["duhar;","⥯"],["dwangle;","⦦"],["dzcy;","џ"],["dzigrarr;","⟿"],["eDDot;","⩷"],["eDot;","≑"],["eacute","é"],["eacute;","é"],["easter;","⩮"],["ecaron;","ě"],["ecir;","≖"],["ecirc","ê"],["ecirc;","ê"],["ecolon;","≕"],["ecy;","э"],["edot;","ė"],["ee;","ⅇ"],["efDot;","≒"],["efr;","𝔢"],["eg;","⪚"],["egrave","è"],["egrave;","è"],["egs;","⪖"],["egsdot;","⪘"],["el;","⪙"],["elinters;","⏧"],["ell;","ℓ"],["els;","⪕"],["elsdot;","⪗"],["emacr;","ē"],["empty;","∅"],["emptyset;","∅"],["emptyv;","∅"],["emsp13;"," "],["emsp14;"," "],["emsp;"," "],["eng;","ŋ"],["ensp;"," "],["eogon;","ę"],["eopf;","𝕖"],["epar;","⋕"],["eparsl;","⧣"],["eplus;","⩱"],["epsi;","ε"],["epsilon;","ε"],["epsiv;","ϵ"],["eqcirc;","≖"],["eqcolon;","≕"],["eqsim;","≂"],["eqslantgtr;","⪖"],["eqslantless;","⪕"],["equals;","="],["equest;","≟"],["equiv;","≡"],["equivDD;","⩸"],["eqvparsl;","⧥"],["erDot;","≓"],["erarr;","⥱"],["escr;","ℯ"],["esdot;","≐"],["esim;","≂"],["eta;","η"],["eth","ð"],["eth;","ð"],["euml","ë"],["euml;","ë"],["euro;","€"],["excl;","!"],["exist;","∃"],["expectation;","ℰ"],["exponentiale;","ⅇ"],["fallingdotseq;","≒"],["fcy;","ф"],["female;","♀"],["ffilig;","ﬃ"],["fflig;","ﬀ"],["ffllig;","ﬄ"],["ffr;","𝔣"],["filig;","ﬁ"],["fjlig;","fj"],["flat;","♭"],["fllig;","ﬂ"],["fltns;","▱"],["fnof;","ƒ"],["fopf;","𝕗"],["forall;","∀"],["fork;","⋔"],["forkv;","⫙"],["fpartint;","⨍"],["frac12","½"],["frac12;","½"],["frac13;","⅓"],["frac14","¼"],["frac14;","¼"],["frac15;","⅕"],["frac16;","⅙"],["frac18;","⅛"],["frac23;","⅔"],["frac25;","⅖"],["frac34","¾"],["frac34;","¾"],["frac35;","⅗"],["frac38;","⅜"],["frac45;","⅘"],["frac56;","⅚"],["frac58;","⅝"],["frac78;","⅞"],["frasl;","⁄"],["frown;","⌢"],["fscr;","𝒻"],["gE;","≧"],["gEl;","⪌"],["gacute;","ǵ"],["gamma;","γ"],["gammad;","ϝ"],["gap;","⪆"],["gbreve;","ğ"],["gcirc;","ĝ"],["gcy;","г"],["gdot;","ġ"],["ge;","≥"],["gel;","⋛"],["geq;","≥"],["geqq;","≧"],["geqslant;","⩾"],["ges;","⩾"],["gescc;","⪩"],["gesdot;","⪀"],["gesdoto;","⪂"],["gesdotol;","⪄"],["gesl;","⋛︀"],["gesles;","⪔"],["gfr;","𝔤"],["gg;","≫"],["ggg;","⋙"],["gimel;","ℷ"],["gjcy;","ѓ"],["gl;","≷"],["glE;","⪒"],["gla;","⪥"],["glj;","⪤"],["gnE;","≩"],["gnap;","⪊"],["gnapprox;","⪊"],["gne;","⪈"],["gneq;","⪈"],["gneqq;","≩"],["gnsim;","⋧"],["gopf;","𝕘"],["grave;","`"],["gscr;","ℊ"],["gsim;","≳"],["gsime;","⪎"],["gsiml;","⪐"],["gt",">"],["gt;",">"],["gtcc;","⪧"],["gtcir;","⩺"],["gtdot;","⋗"],["gtlPar;","⦕"],["gtquest;","⩼"],["gtrapprox;","⪆"],["gtrarr;","⥸"],["gtrdot;","⋗"],["gtreqless;","⋛"],["gtreqqless;","⪌"],["gtrless;","≷"],["gtrsim;","≳"],["gvertneqq;","≩︀"],["gvnE;","≩︀"],["hArr;","⇔"],["hairsp;"," "],["half;","½"],["hamilt;","ℋ"],["hardcy;","ъ"],["harr;","↔"],["harrcir;","⥈"],["harrw;","↭"],["hbar;","ℏ"],["hcirc;","ĥ"],["hearts;","♥"],["heartsuit;","♥"],["hellip;","…"],["hercon;","⊹"],["hfr;","𝔥"],["hksearow;","⤥"],["hkswarow;","⤦"],["hoarr;","⇿"],["homtht;","∻"],["hookleftarrow;","↩"],["hookrightarrow;","↪"],["hopf;","𝕙"],["horbar;","―"],["hscr;","𝒽"],["hslash;","ℏ"],["hstrok;","ħ"],["hybull;","⁃"],["hyphen;","‐"],["iacute","í"],["iacute;","í"],["ic;","⁣"],["icirc","î"],["icirc;","î"],["icy;","и"],["iecy;","е"],["iexcl","¡"],["iexcl;","¡"],["iff;","⇔"],["ifr;","𝔦"],["igrave","ì"],["igrave;","ì"],["ii;","ⅈ"],["iiiint;","⨌"],["iiint;","∭"],["iinfin;","⧜"],["iiota;","℩"],["ijlig;","ĳ"],["imacr;","ī"],["image;","ℑ"],["imagline;","ℐ"],["imagpart;","ℑ"],["imath;","ı"],["imof;","⊷"],["imped;","Ƶ"],["in;","∈"],["incare;","℅"],["infin;","∞"],["infintie;","⧝"],["inodot;","ı"],["int;","∫"],["intcal;","⊺"],["integers;","ℤ"],["intercal;","⊺"],["intlarhk;","⨗"],["intprod;","⨼"],["iocy;","ё"],["iogon;","į"],["iopf;","𝕚"],["iota;","ι"],["iprod;","⨼"],["iquest","¿"],["iquest;","¿"],["iscr;","𝒾"],["isin;","∈"],["isinE;","⋹"],["isindot;","⋵"],["isins;","⋴"],["isinsv;","⋳"],["isinv;","∈"],["it;","⁢"],["itilde;","ĩ"],["iukcy;","і"],["iuml","ï"],["iuml;","ï"],["jcirc;","ĵ"],["jcy;","й"],["jfr;","𝔧"],["jmath;","ȷ"],["jopf;","𝕛"],["jscr;","𝒿"],["jsercy;","ј"],["jukcy;","є"],["kappa;","κ"],["kappav;","ϰ"],["kcedil;","ķ"],["kcy;","к"],["kfr;","𝔨"],["kgreen;","ĸ"],["khcy;","х"],["kjcy;","ќ"],["kopf;","𝕜"],["kscr;","𝓀"],["lAarr;","⇚"],["lArr;","⇐"],["lAtail;","⤛"],["lBarr;","⤎"],["lE;","≦"],["lEg;","⪋"],["lHar;","⥢"],["lacute;","ĺ"],["laemptyv;","⦴"],["lagran;","ℒ"],["lambda;","λ"],["lang;","⟨"],["langd;","⦑"],["langle;","⟨"],["lap;","⪅"],["laquo","«"],["laquo;","«"],["larr;","←"],["larrb;","⇤"],["larrbfs;","⤟"],["larrfs;","⤝"],["larrhk;","↩"],["larrlp;","↫"],["larrpl;","⤹"],["larrsim;","⥳"],["larrtl;","↢"],["lat;","⪫"],["latail;","⤙"],["late;","⪭"],["lates;","⪭︀"],["lbarr;","⤌"],["lbbrk;","❲"],["lbrace;","{"],["lbrack;","["],["lbrke;","⦋"],["lbrksld;","⦏"],["lbrkslu;","⦍"],["lcaron;","ľ"],["lcedil;","ļ"],["lceil;","⌈"],["lcub;","{"],["lcy;","л"],["ldca;","⤶"],["ldquo;","“"],["ldquor;","„"],["ldrdhar;","⥧"],["ldrushar;","⥋"],["ldsh;","↲"],["le;","≤"],["leftarrow;","←"],["leftarrowtail;","↢"],["leftharpoondown;","↽"],["leftharpoonup;","↼"],["leftleftarrows;","⇇"],["leftrightarrow;","↔"],["leftrightarrows;","⇆"],["leftrightharpoons;","⇋"],["leftrightsquigarrow;","↭"],["leftthreetimes;","⋋"],["leg;","⋚"],["leq;","≤"],["leqq;","≦"],["leqslant;","⩽"],["les;","⩽"],["lescc;","⪨"],["lesdot;","⩿"],["lesdoto;","⪁"],["lesdotor;","⪃"],["lesg;","⋚︀"],["lesges;","⪓"],["lessapprox;","⪅"],["lessdot;","⋖"],["lesseqgtr;","⋚"],["lesseqqgtr;","⪋"],["lessgtr;","≶"],["lesssim;","≲"],["lfisht;","⥼"],["lfloor;","⌊"],["lfr;","𝔩"],["lg;","≶"],["lgE;","⪑"],["lhard;","↽"],["lharu;","↼"],["lharul;","⥪"],["lhblk;","▄"],["ljcy;","љ"],["ll;","≪"],["llarr;","⇇"],["llcorner;","⌞"],["llhard;","⥫"],["lltri;","◺"],["lmidot;","ŀ"],["lmoust;","⎰"],["lmoustache;","⎰"],["lnE;","≨"],["lnap;","⪉"],["lnapprox;","⪉"],["lne;","⪇"],["lneq;","⪇"],["lneqq;","≨"],["lnsim;","⋦"],["loang;","⟬"],["loarr;","⇽"],["lobrk;","⟦"],["longleftarrow;","⟵"],["longleftrightarrow;","⟷"],["longmapsto;","⟼"],["longrightarrow;","⟶"],["looparrowleft;","↫"],["looparrowright;","↬"],["lopar;","⦅"],["lopf;","𝕝"],["loplus;","⨭"],["lotimes;","⨴"],["lowast;","∗"],["lowbar;","_"],["loz;","◊"],["lozenge;","◊"],["lozf;","⧫"],["lpar;","("],["lparlt;","⦓"],["lrarr;","⇆"],["lrcorner;","⌟"],["lrhar;","⇋"],["lrhard;","⥭"],["lrm;","‎"],["lrtri;","⊿"],["lsaquo;","‹"],["lscr;","𝓁"],["lsh;","↰"],["lsim;","≲"],["lsime;","⪍"],["lsimg;","⪏"],["lsqb;","["],["lsquo;","‘"],["lsquor;","‚"],["lstrok;","ł"],["lt","<"],["lt;","<"],["ltcc;","⪦"],["ltcir;","⩹"],["ltdot;","⋖"],["lthree;","⋋"],["ltimes;","⋉"],["ltlarr;","⥶"],["ltquest;","⩻"],["ltrPar;","⦖"],["ltri;","◃"],["ltrie;","⊴"],["ltrif;","◂"],["lurdshar;","⥊"],["luruhar;","⥦"],["lvertneqq;","≨︀"],["lvnE;","≨︀"],["mDDot;","∺"],["macr","¯"],["macr;","¯"],["male;","♂"],["malt;","✠"],["maltese;","✠"],["map;","↦"],["mapsto;","↦"],["mapstodown;","↧"],["mapstoleft;","↤"],["mapstoup;","↥"],["marker;","▮"],["mcomma;","⨩"],["mcy;","м"],["mdash;","—"],["measuredangle;","∡"],["mfr;","𝔪"],["mho;","℧"],["micro","µ"],["micro;","µ"],["mid;","∣"],["midast;","*"],["midcir;","⫰"],["middot","·"],["middot;","·"],["minus;","−"],["minusb;","⊟"],["minusd;","∸"],["minusdu;","⨪"],["mlcp;","⫛"],["mldr;","…"],["mnplus;","∓"],["models;","⊧"],["mopf;","𝕞"],["mp;","∓"],["mscr;","𝓂"],["mstpos;","∾"],["mu;","μ"],["multimap;","⊸"],["mumap;","⊸"],["nGg;","⋙̸"],["nGt;","≫⃒"],["nGtv;","≫̸"],["nLeftarrow;","⇍"],["nLeftrightarrow;","⇎"],["nLl;","⋘̸"],["nLt;","≪⃒"],["nLtv;","≪̸"],["nRightarrow;","⇏"],["nVDash;","⊯"],["nVdash;","⊮"],["nabla;","∇"],["nacute;","ń"],["nang;","∠⃒"],["nap;","≉"],["napE;","⩰̸"],["napid;","≋̸"],["napos;","ŉ"],["napprox;","≉"],["natur;","♮"],["natural;","♮"],["naturals;","ℕ"],["nbsp"," "],["nbsp;"," "],["nbump;","≎̸"],["nbumpe;","≏̸"],["ncap;","⩃"],["ncaron;","ň"],["ncedil;","ņ"],["ncong;","≇"],["ncongdot;","⩭̸"],["ncup;","⩂"],["ncy;","н"],["ndash;","–"],["ne;","≠"],["neArr;","⇗"],["nearhk;","⤤"],["nearr;","↗"],["nearrow;","↗"],["nedot;","≐̸"],["nequiv;","≢"],["nesear;","⤨"],["nesim;","≂̸"],["nexist;","∄"],["nexists;","∄"],["nfr;","𝔫"],["ngE;","≧̸"],["nge;","≱"],["ngeq;","≱"],["ngeqq;","≧̸"],["ngeqslant;","⩾̸"],["nges;","⩾̸"],["ngsim;","≵"],["ngt;","≯"],["ngtr;","≯"],["nhArr;","⇎"],["nharr;","↮"],["nhpar;","⫲"],["ni;","∋"],["nis;","⋼"],["nisd;","⋺"],["niv;","∋"],["njcy;","њ"],["nlArr;","⇍"],["nlE;","≦̸"],["nlarr;","↚"],["nldr;","‥"],["nle;","≰"],["nleftarrow;","↚"],["nleftrightarrow;","↮"],["nleq;","≰"],["nleqq;","≦̸"],["nleqslant;","⩽̸"],["nles;","⩽̸"],["nless;","≮"],["nlsim;","≴"],["nlt;","≮"],["nltri;","⋪"],["nltrie;","⋬"],["nmid;","∤"],["nopf;","𝕟"],["not","¬"],["not;","¬"],["notin;","∉"],["notinE;","⋹̸"],["notindot;","⋵̸"],["notinva;","∉"],["notinvb;","⋷"],["notinvc;","⋶"],["notni;","∌"],["notniva;","∌"],["notnivb;","⋾"],["notnivc;","⋽"],["npar;","∦"],["nparallel;","∦"],["nparsl;","⫽⃥"],["npart;","∂̸"],["npolint;","⨔"],["npr;","⊀"],["nprcue;","⋠"],["npre;","⪯̸"],["nprec;","⊀"],["npreceq;","⪯̸"],["nrArr;","⇏"],["nrarr;","↛"],["nrarrc;","⤳̸"],["nrarrw;","↝̸"],["nrightarrow;","↛"],["nrtri;","⋫"],["nrtrie;","⋭"],["nsc;","⊁"],["nsccue;","⋡"],["nsce;","⪰̸"],["nscr;","𝓃"],["nshortmid;","∤"],["nshortparallel;","∦"],["nsim;","≁"],["nsime;","≄"],["nsimeq;","≄"],["nsmid;","∤"],["nspar;","∦"],["nsqsube;","⋢"],["nsqsupe;","⋣"],["nsub;","⊄"],["nsubE;","⫅̸"],["nsube;","⊈"],["nsubset;","⊂⃒"],["nsubseteq;","⊈"],["nsubseteqq;","⫅̸"],["nsucc;","⊁"],["nsucceq;","⪰̸"],["nsup;","⊅"],["nsupE;","⫆̸"],["nsupe;","⊉"],["nsupset;","⊃⃒"],["nsupseteq;","⊉"],["nsupseteqq;","⫆̸"],["ntgl;","≹"],["ntilde","ñ"],["ntilde;","ñ"],["ntlg;","≸"],["ntriangleleft;","⋪"],["ntrianglelefteq;","⋬"],["ntriangleright;","⋫"],["ntrianglerighteq;","⋭"],["nu;","ν"],["num;","#"],["numero;","№"],["numsp;"," "],["nvDash;","⊭"],["nvHarr;","⤄"],["nvap;","≍⃒"],["nvdash;","⊬"],["nvge;","≥⃒"],["nvgt;",">⃒"],["nvinfin;","⧞"],["nvlArr;","⤂"],["nvle;","≤⃒"],["nvlt;","<⃒"],["nvltrie;","⊴⃒"],["nvrArr;","⤃"],["nvrtrie;","⊵⃒"],["nvsim;","∼⃒"],["nwArr;","⇖"],["nwarhk;","⤣"],["nwarr;","↖"],["nwarrow;","↖"],["nwnear;","⤧"],["oS;","Ⓢ"],["oacute","ó"],["oacute;","ó"],["oast;","⊛"],["ocir;","⊚"],["ocirc","ô"],["ocirc;","ô"],["ocy;","о"],["odash;","⊝"],["odblac;","ő"],["odiv;","⨸"],["odot;","⊙"],["odsold;","⦼"],["oelig;","œ"],["ofcir;","⦿"],["ofr;","𝔬"],["ogon;","˛"],["ograve","ò"],["ograve;","ò"],["ogt;","⧁"],["ohbar;","⦵"],["ohm;","Ω"],["oint;","∮"],["olarr;","↺"],["olcir;","⦾"],["olcross;","⦻"],["oline;","‾"],["olt;","⧀"],["omacr;","ō"],["omega;","ω"],["omicron;","ο"],["omid;","⦶"],["ominus;","⊖"],["oopf;","𝕠"],["opar;","⦷"],["operp;","⦹"],["oplus;","⊕"],["or;","∨"],["orarr;","↻"],["ord;","⩝"],["order;","ℴ"],["orderof;","ℴ"],["ordf","ª"],["ordf;","ª"],["ordm","º"],["ordm;","º"],["origof;","⊶"],["oror;","⩖"],["orslope;","⩗"],["orv;","⩛"],["oscr;","ℴ"],["oslash","ø"],["oslash;","ø"],["osol;","⊘"],["otilde","õ"],["otilde;","õ"],["otimes;","⊗"],["otimesas;","⨶"],["ouml","ö"],["ouml;","ö"],["ovbar;","⌽"],["par;","∥"],["para","¶"],["para;","¶"],["parallel;","∥"],["parsim;","⫳"],["parsl;","⫽"],["part;","∂"],["pcy;","п"],["percnt;","%"],["period;","."],["permil;","‰"],["perp;","⊥"],["pertenk;","‱"],["pfr;","𝔭"],["phi;","φ"],["phiv;","ϕ"],["phmmat;","ℳ"],["phone;","☎"],["pi;","π"],["pitchfork;","⋔"],["piv;","ϖ"],["planck;","ℏ"],["planckh;","ℎ"],["plankv;","ℏ"],["plus;","+"],["plusacir;","⨣"],["plusb;","⊞"],["pluscir;","⨢"],["plusdo;","∔"],["plusdu;","⨥"],["pluse;","⩲"],["plusmn","±"],["plusmn;","±"],["plussim;","⨦"],["plustwo;","⨧"],["pm;","±"],["pointint;","⨕"],["popf;","𝕡"],["pound","£"],["pound;","£"],["pr;","≺"],["prE;","⪳"],["prap;","⪷"],["prcue;","≼"],["pre;","⪯"],["prec;","≺"],["precapprox;","⪷"],["preccurlyeq;","≼"],["preceq;","⪯"],["precnapprox;","⪹"],["precneqq;","⪵"],["precnsim;","⋨"],["precsim;","≾"],["prime;","′"],["primes;","ℙ"],["prnE;","⪵"],["prnap;","⪹"],["prnsim;","⋨"],["prod;","∏"],["profalar;","⌮"],["profline;","⌒"],["profsurf;","⌓"],["prop;","∝"],["propto;","∝"],["prsim;","≾"],["prurel;","⊰"],["pscr;","𝓅"],["psi;","ψ"],["puncsp;"," "],["qfr;","𝔮"],["qint;","⨌"],["qopf;","𝕢"],["qprime;","⁗"],["qscr;","𝓆"],["quaternions;","ℍ"],["quatint;","⨖"],["quest;","?"],["questeq;","≟"],["quot","\\""],["quot;","\\""],["rAarr;","⇛"],["rArr;","⇒"],["rAtail;","⤜"],["rBarr;","⤏"],["rHar;","⥤"],["race;","∽̱"],["racute;","ŕ"],["radic;","√"],["raemptyv;","⦳"],["rang;","⟩"],["rangd;","⦒"],["range;","⦥"],["rangle;","⟩"],["raquo","»"],["raquo;","»"],["rarr;","→"],["rarrap;","⥵"],["rarrb;","⇥"],["rarrbfs;","⤠"],["rarrc;","⤳"],["rarrfs;","⤞"],["rarrhk;","↪"],["rarrlp;","↬"],["rarrpl;","⥅"],["rarrsim;","⥴"],["rarrtl;","↣"],["rarrw;","↝"],["ratail;","⤚"],["ratio;","∶"],["rationals;","ℚ"],["rbarr;","⤍"],["rbbrk;","❳"],["rbrace;","}"],["rbrack;","]"],["rbrke;","⦌"],["rbrksld;","⦎"],["rbrkslu;","⦐"],["rcaron;","ř"],["rcedil;","ŗ"],["rceil;","⌉"],["rcub;","}"],["rcy;","р"],["rdca;","⤷"],["rdldhar;","⥩"],["rdquo;","”"],["rdquor;","”"],["rdsh;","↳"],["real;","ℜ"],["realine;","ℛ"],["realpart;","ℜ"],["reals;","ℝ"],["rect;","▭"],["reg","®"],["reg;","®"],["rfisht;","⥽"],["rfloor;","⌋"],["rfr;","𝔯"],["rhard;","⇁"],["rharu;","⇀"],["rharul;","⥬"],["rho;","ρ"],["rhov;","ϱ"],["rightarrow;","→"],["rightarrowtail;","↣"],["rightharpoondown;","⇁"],["rightharpoonup;","⇀"],["rightleftarrows;","⇄"],["rightleftharpoons;","⇌"],["rightrightarrows;","⇉"],["rightsquigarrow;","↝"],["rightthreetimes;","⋌"],["ring;","˚"],["risingdotseq;","≓"],["rlarr;","⇄"],["rlhar;","⇌"],["rlm;","‏"],["rmoust;","⎱"],["rmoustache;","⎱"],["rnmid;","⫮"],["roang;","⟭"],["roarr;","⇾"],["robrk;","⟧"],["ropar;","⦆"],["ropf;","𝕣"],["roplus;","⨮"],["rotimes;","⨵"],["rpar;",")"],["rpargt;","⦔"],["rppolint;","⨒"],["rrarr;","⇉"],["rsaquo;","›"],["rscr;","𝓇"],["rsh;","↱"],["rsqb;","]"],["rsquo;","’"],["rsquor;","’"],["rthree;","⋌"],["rtimes;","⋊"],["rtri;","▹"],["rtrie;","⊵"],["rtrif;","▸"],["rtriltri;","⧎"],["ruluhar;","⥨"],["rx;","℞"],["sacute;","ś"],["sbquo;","‚"],["sc;","≻"],["scE;","⪴"],["scap;","⪸"],["scaron;","š"],["sccue;","≽"],["sce;","⪰"],["scedil;","ş"],["scirc;","ŝ"],["scnE;","⪶"],["scnap;","⪺"],["scnsim;","⋩"],["scpolint;","⨓"],["scsim;","≿"],["scy;","с"],["sdot;","⋅"],["sdotb;","⊡"],["sdote;","⩦"],["seArr;","⇘"],["searhk;","⤥"],["searr;","↘"],["searrow;","↘"],["sect","§"],["sect;","§"],["semi;",";"],["seswar;","⤩"],["setminus;","∖"],["setmn;","∖"],["sext;","✶"],["sfr;","𝔰"],["sfrown;","⌢"],["sharp;","♯"],["shchcy;","щ"],["shcy;","ш"],["shortmid;","∣"],["shortparallel;","∥"],["shy","­"],["shy;","­"],["sigma;","σ"],["sigmaf;","ς"],["sigmav;","ς"],["sim;","∼"],["simdot;","⩪"],["sime;","≃"],["simeq;","≃"],["simg;","⪞"],["simgE;","⪠"],["siml;","⪝"],["simlE;","⪟"],["simne;","≆"],["simplus;","⨤"],["simrarr;","⥲"],["slarr;","←"],["smallsetminus;","∖"],["smashp;","⨳"],["smeparsl;","⧤"],["smid;","∣"],["smile;","⌣"],["smt;","⪪"],["smte;","⪬"],["smtes;","⪬︀"],["softcy;","ь"],["sol;","/"],["solb;","⧄"],["solbar;","⌿"],["sopf;","𝕤"],["spades;","♠"],["spadesuit;","♠"],["spar;","∥"],["sqcap;","⊓"],["sqcaps;","⊓︀"],["sqcup;","⊔"],["sqcups;","⊔︀"],["sqsub;","⊏"],["sqsube;","⊑"],["sqsubset;","⊏"],["sqsubseteq;","⊑"],["sqsup;","⊐"],["sqsupe;","⊒"],["sqsupset;","⊐"],["sqsupseteq;","⊒"],["squ;","□"],["square;","□"],["squarf;","▪"],["squf;","▪"],["srarr;","→"],["sscr;","𝓈"],["ssetmn;","∖"],["ssmile;","⌣"],["sstarf;","⋆"],["star;","☆"],["starf;","★"],["straightepsilon;","ϵ"],["straightphi;","ϕ"],["strns;","¯"],["sub;","⊂"],["subE;","⫅"],["subdot;","⪽"],["sube;","⊆"],["subedot;","⫃"],["submult;","⫁"],["subnE;","⫋"],["subne;","⊊"],["subplus;","⪿"],["subrarr;","⥹"],["subset;","⊂"],["subseteq;","⊆"],["subseteqq;","⫅"],["subsetneq;","⊊"],["subsetneqq;","⫋"],["subsim;","⫇"],["subsub;","⫕"],["subsup;","⫓"],["succ;","≻"],["succapprox;","⪸"],["succcurlyeq;","≽"],["succeq;","⪰"],["succnapprox;","⪺"],["succneqq;","⪶"],["succnsim;","⋩"],["succsim;","≿"],["sum;","∑"],["sung;","♪"],["sup1","¹"],["sup1;","¹"],["sup2","²"],["sup2;","²"],["sup3","³"],["sup3;","³"],["sup;","⊃"],["supE;","⫆"],["supdot;","⪾"],["supdsub;","⫘"],["supe;","⊇"],["supedot;","⫄"],["suphsol;","⟉"],["suphsub;","⫗"],["suplarr;","⥻"],["supmult;","⫂"],["supnE;","⫌"],["supne;","⊋"],["supplus;","⫀"],["supset;","⊃"],["supseteq;","⊇"],["supseteqq;","⫆"],["supsetneq;","⊋"],["supsetneqq;","⫌"],["supsim;","⫈"],["supsub;","⫔"],["supsup;","⫖"],["swArr;","⇙"],["swarhk;","⤦"],["swarr;","↙"],["swarrow;","↙"],["swnwar;","⤪"],["szlig","ß"],["szlig;","ß"],["target;","⌖"],["tau;","τ"],["tbrk;","⎴"],["tcaron;","ť"],["tcedil;","ţ"],["tcy;","т"],["tdot;","⃛"],["telrec;","⌕"],["tfr;","𝔱"],["there4;","∴"],["therefore;","∴"],["theta;","θ"],["thetasym;","ϑ"],["thetav;","ϑ"],["thickapprox;","≈"],["thicksim;","∼"],["thinsp;"," "],["thkap;","≈"],["thksim;","∼"],["thorn","þ"],["thorn;","þ"],["tilde;","˜"],["times","×"],["times;","×"],["timesb;","⊠"],["timesbar;","⨱"],["timesd;","⨰"],["tint;","∭"],["toea;","⤨"],["top;","⊤"],["topbot;","⌶"],["topcir;","⫱"],["topf;","𝕥"],["topfork;","⫚"],["tosa;","⤩"],["tprime;","‴"],["trade;","™"],["triangle;","▵"],["triangledown;","▿"],["triangleleft;","◃"],["trianglelefteq;","⊴"],["triangleq;","≜"],["triangleright;","▹"],["trianglerighteq;","⊵"],["tridot;","◬"],["trie;","≜"],["triminus;","⨺"],["triplus;","⨹"],["trisb;","⧍"],["tritime;","⨻"],["trpezium;","⏢"],["tscr;","𝓉"],["tscy;","ц"],["tshcy;","ћ"],["tstrok;","ŧ"],["twixt;","≬"],["twoheadleftarrow;","↞"],["twoheadrightarrow;","↠"],["uArr;","⇑"],["uHar;","⥣"],["uacute","ú"],["uacute;","ú"],["uarr;","↑"],["ubrcy;","ў"],["ubreve;","ŭ"],["ucirc","û"],["ucirc;","û"],["ucy;","у"],["udarr;","⇅"],["udblac;","ű"],["udhar;","⥮"],["ufisht;","⥾"],["ufr;","𝔲"],["ugrave","ù"],["ugrave;","ù"],["uharl;","↿"],["uharr;","↾"],["uhblk;","▀"],["ulcorn;","⌜"],["ulcorner;","⌜"],["ulcrop;","⌏"],["ultri;","◸"],["umacr;","ū"],["uml","¨"],["uml;","¨"],["uogon;","ų"],["uopf;","𝕦"],["uparrow;","↑"],["updownarrow;","↕"],["upharpoonleft;","↿"],["upharpoonright;","↾"],["uplus;","⊎"],["upsi;","υ"],["upsih;","ϒ"],["upsilon;","υ"],["upuparrows;","⇈"],["urcorn;","⌝"],["urcorner;","⌝"],["urcrop;","⌎"],["uring;","ů"],["urtri;","◹"],["uscr;","𝓊"],["utdot;","⋰"],["utilde;","ũ"],["utri;","▵"],["utrif;","▴"],["uuarr;","⇈"],["uuml","ü"],["uuml;","ü"],["uwangle;","⦧"],["vArr;","⇕"],["vBar;","⫨"],["vBarv;","⫩"],["vDash;","⊨"],["vangrt;","⦜"],["varepsilon;","ϵ"],["varkappa;","ϰ"],["varnothing;","∅"],["varphi;","ϕ"],["varpi;","ϖ"],["varpropto;","∝"],["varr;","↕"],["varrho;","ϱ"],["varsigma;","ς"],["varsubsetneq;","⊊︀"],["varsubsetneqq;","⫋︀"],["varsupsetneq;","⊋︀"],["varsupsetneqq;","⫌︀"],["vartheta;","ϑ"],["vartriangleleft;","⊲"],["vartriangleright;","⊳"],["vcy;","в"],["vdash;","⊢"],["vee;","∨"],["veebar;","⊻"],["veeeq;","≚"],["vellip;","⋮"],["verbar;","|"],["vert;","|"],["vfr;","𝔳"],["vltri;","⊲"],["vnsub;","⊂⃒"],["vnsup;","⊃⃒"],["vopf;","𝕧"],["vprop;","∝"],["vrtri;","⊳"],["vscr;","𝓋"],["vsubnE;","⫋︀"],["vsubne;","⊊︀"],["vsupnE;","⫌︀"],["vsupne;","⊋︀"],["vzigzag;","⦚"],["wcirc;","ŵ"],["wedbar;","⩟"],["wedge;","∧"],["wedgeq;","≙"],["weierp;","℘"],["wfr;","𝔴"],["wopf;","𝕨"],["wp;","℘"],["wr;","≀"],["wreath;","≀"],["wscr;","𝓌"],["xcap;","⋂"],["xcirc;","◯"],["xcup;","⋃"],["xdtri;","▽"],["xfr;","𝔵"],["xhArr;","⟺"],["xharr;","⟷"],["xi;","ξ"],["xlArr;","⟸"],["xlarr;","⟵"],["xmap;","⟼"],["xnis;","⋻"],["xodot;","⨀"],["xopf;","𝕩"],["xoplus;","⨁"],["xotime;","⨂"],["xrArr;","⟹"],["xrarr;","⟶"],["xscr;","𝓍"],["xsqcup;","⨆"],["xuplus;","⨄"],["xutri;","△"],["xvee;","⋁"],["xwedge;","⋀"],["yacute","ý"],["yacute;","ý"],["yacy;","я"],["ycirc;","ŷ"],["ycy;","ы"],["yen","¥"],["yen;","¥"],["yfr;","𝔶"],["yicy;","ї"],["yopf;","𝕪"],["yscr;","𝓎"],["yucy;","ю"],["yuml","ÿ"],["yuml;","ÿ"],["zacute;","ź"],["zcaron;","ž"],["zcy;","з"],["zdot;","ż"],["zeetrf;","ℨ"],["zeta;","ζ"],["zfr;","𝔷"],["zhcy;","ж"],["zigrarr;","⇝"],["zopf;","𝕫"],["zscr;","𝓏"],["zwj;","‍"],["zwnj;","‌"]]'
));
// </generated-entities>

const NUMERIC_REMAP: Record<number, number> = {
  0x00: 0xfffd,
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178
};

function codePointToString(cp: number): string {
  // All NUMERIC_REMAP keys are 0 or in [0x80, 0x9f], so skip the hash probe for
  // the overwhelmingly common in-range code points.
  if (cp === 0 || (cp >= 0x80 && cp <= 0x9f)) {
    const remapped = NUMERIC_REMAP[cp];
    if (remapped !== undefined) cp = remapped;
  }
  if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '�';
  }
}

interface EntityMatch {
  value: string;
  length: number;
}

const CC_AMP = 38; // &
const CC_HASH = 35; // #
const CC_SEMI = 59; // ;
const CC_EQ = 61; // =

function isAsciiDigit(cc: number): boolean {
  return cc >= 48 && cc <= 57;
}

function isAsciiAlphaNum(cc: number): boolean {
  return (
    (cc >= 48 && cc <= 57) || // 0-9
    (cc >= 65 && cc <= 90) || // A-Z
    (cc >= 97 && cc <= 122) // a-z
  );
}

// Sorted entity names (keys include any trailing ';') for prefix queries during
// the trie walk — lets us know whether the input can keep descending toward a
// longer entity, which the attribute ambiguous-ampersand rule depends on.
const ENTITY_KEYS_SORTED = [...NAMED_ENTITIES.keys()].sort();

/** True if `s` is a prefix of (or equal to) some entity key. */
function isEntityPrefix(s: string): boolean {
  let lo = 0;
  let hi = ENTITY_KEYS_SORTED.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ENTITY_KEYS_SORTED[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  return lo < ENTITY_KEYS_SORTED.length && ENTITY_KEYS_SORTED[lo].startsWith(s);
}

/**
 * Decode a single character reference starting at `&` (index `i`), matching the
 * WHATWG HTML algorithm as implemented by the `entities` package (which the
 * original sanitize-html uses via htmlparser2):
 *
 *   - Numeric refs (`&#233;`, `&#x1F600;`) decode regardless of context, with
 *     the Windows-1252 remap and surrogate/out-of-range → U+FFFD.
 *   - Named refs use longest-match; a semicolon-terminated form wins when the
 *     `;` is present, otherwise a legacy no-semicolon form may match.
 *   - In attribute context, a legacy (no-`;`) match is treated as an ambiguous
 *     ampersand and left undecoded when followed by `=` or an ASCII alphanumeric
 *     (so `?a=1&copy=2` is preserved rather than mangled).
 *
 * Returns `null` when no valid reference is present (caller emits a literal `&`).
 */
function decodeEntity(
  input: string,
  i: number,
  inAttribute: boolean
): EntityMatch | null {
  if (input.charCodeAt(i) !== CC_AMP) return null;

  // --- numeric character reference -----------------------------------------
  if (input.charCodeAt(i + 1) === CC_HASH) {
    let j = i + 2;
    const xc = input.charCodeAt(j);
    const hex = xc === 120 || xc === 88; // x / X
    if (hex) j++;
    const start = j;
    let num = 0;
    while (j < input.length) {
      const cc = input.charCodeAt(j);
      let digit: number;
      if (isAsciiDigit(cc)) digit = cc - 48;
      else if (hex && cc >= 97 && cc <= 102) digit = cc - 87; // a-f
      else if (hex && cc >= 65 && cc <= 70) digit = cc - 55; // A-F
      else break;
      // Stop accumulating once out of range; anything past U+10FFFF maps to the
      // replacement character regardless, and this prevents Number overflow.
      if (num <= 0x10ffff) num = num * (hex ? 16 : 10) + digit;
      j++;
    }
    if (j === start) return null;
    let length = j - i;
    if (input.charCodeAt(j) === CC_SEMI) length++;
    return { value: codePointToString(num), length };
  }

  // --- named character reference -------------------------------------------
  const len = input.length;
  let resultValue: string | null = null;
  let resultLen = 0; // chars from i (incl. '&') consumed by the legacy result
  let name = '';
  let j = i + 1;

  if (!inAttribute) {
    // Fast path for the common semicolon-terminated entity (`&amp;`, `&eacute;`):
    // scan the name extent and look up `name;` in ONE Map.get, skipping the
    // per-prefix probes. A `;`-terminated form is always the longest match, so
    // a hit is final. (k stops at the `;` even for the 31-char max entity.)
    let k = j;
    while (k < len && k - j < MAX_ENTITY_NAME_LENGTH && isAsciiAlphaNum(input.charCodeAt(k))) k++;
    if (k < len && input.charCodeAt(k) === CC_SEMI) {
      const full = NAMED_ENTITIES.get(input.substring(j, k + 1));
      if (full !== undefined) return { value: full, length: k + 1 - i };
    }
    // Fallback: longest legacy (no-`;`) match, or a `;` entity the fast path
    // missed. Scans ASCII alphanumerics, probing each prefix.
    while (j < len) {
      const cc = input.charCodeAt(j);
      if (cc === CC_SEMI) {
        const semi = NAMED_ENTITIES.get(name + ';');
        if (semi !== undefined) return { value: semi, length: j - i + 1 };
        break;
      }
      if (name.length >= MAX_ENTITY_NAME_LENGTH || !isAsciiAlphaNum(cc)) break;
      name += input[j];
      j++;
      const legacy = NAMED_ENTITIES.get(name);
      if (legacy !== undefined) {
        resultValue = legacy;
        resultLen = j - i;
      }
    }
    return resultValue === null ? null : { value: resultValue, length: resultLen };
  }

  // Fast path: a `;`-terminated form wins outright and is NOT subject to the
  // ambiguous-ampersand rule, so look it up in one Map.get and skip the trie
  // descent (the costly per-char isEntityPrefix binary search).
  {
    let k = j;
    while (k < len && k - j < MAX_ENTITY_NAME_LENGTH && isAsciiAlphaNum(input.charCodeAt(k))) k++;
    if (k < len && input.charCodeAt(k) === CC_SEMI) {
      const full = NAMED_ENTITIES.get(input.substring(j, k + 1));
      if (full !== undefined) return { value: full, length: k + 1 - i };
    }
  }

  // Attribute mode: walk the entity trie like the `entities` package. A
  // semicolon-terminated form wins outright; otherwise we keep the longest
  // legacy (no-`;`) match, but leave it undecoded ("ambiguous ampersand") when
  // the trie breaks on `=` / an ASCII alphanumeric, OR breaks at a node that
  // itself holds no value — which is why `&timesbar` decodes (descends to
  // `timesbar`, breaks on `"`) but `&ampere` does not (breaks on `e` after `amp`).
  while (j < len) {
    const c = input[j];
    if (c === ';') {
      const semi = NAMED_ENTITIES.get(name + ';');
      if (semi !== undefined) return { value: semi, length: j - i + 1 };
      break; // ';' never extends the trie further
    }
    if (name.length >= MAX_ENTITY_NAME_LENGTH) break;
    const cand = name + c;
    if (!isEntityPrefix(cand)) break;
    name = cand;
    j++;
    const legacy = NAMED_ENTITIES.get(name);
    if (legacy !== undefined) {
      resultValue = legacy;
      resultLen = j - i;
    }
  }
  if (resultValue === null) return null;

  if (j < len) {
    const breakCc = input.charCodeAt(j);
    const nodeHasValue = NAMED_ENTITIES.has(name) || NAMED_ENTITIES.has(name + ';');
    if (!nodeHasValue || breakCc === CC_EQ || isAsciiAlphaNum(breakCc)) return null;
  }
  return { value: resultValue, length: resultLen };
}

function decodeEntitiesString(s: string, inAttribute: boolean): string {
  let i = s.indexOf('&');
  if (i === -1) return s;
  let out = '';
  let last = 0;
  while (i !== -1) {
    const r = decodeEntity(s, i, inAttribute);
    if (r) {
      out += s.slice(last, i) + r.value;
      i += r.length;
      last = i;
    } else {
      i++;
    }
    i = s.indexOf('&', i);
  }
  return out + s.slice(last);
}

// =============================================================================
// Minimal HTML parser
// =============================================================================

const VOID_TAGS = new Set<string>([
  'area', 'base', 'basefont', 'br', 'col', 'command', 'embed', 'frame', 'hr',
  'img', 'input', 'isindex', 'keygen', 'link', 'meta', 'param', 'source',
  'track', 'wbr'
]);

// htmlparser2's special raw-text tags. Only <title> has its entities decoded
// (it is RCDATA in htmlparser2; the rest are consumed verbatim).
const RAW_TEXT_TAGS = new Set<string>([
  'script', 'style', 'title', 'textarea', 'xmp'
]);
const RCDATA_DECODE_TAGS = new Set<string>([ 'title' ]);

// Ported verbatim from htmlparser2's `openImpliesClose` map so implicit tag
// closing matches the original parser exactly.
const OPEN_IMPLIES_CLOSE: Record<string, Set<string>> = (() => {
  const m: Record<string, Set<string>> = {};
  const pTag = [ 'p' ];
  const formTags = [ 'input', 'option', 'optgroup', 'select', 'button', 'datalist', 'textarea' ];
  const tableSectionTags = [ 'thead', 'tbody' ];
  const ddtTags = [ 'dd', 'dt' ];
  const rtpTags = [ 'rt', 'rp' ];
  m.tr = new Set([ 'tr', 'th', 'td' ]);
  m.th = new Set([ 'th' ]);
  m.td = new Set([ 'thead', 'th', 'td' ]);
  m.body = new Set([ 'head', 'link', 'script' ]);
  m.li = new Set([ 'li' ]);
  for (const t of [ 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ]) m[t] = new Set(pTag);
  for (const t of [ 'select', 'input', 'output', 'button', 'datalist', 'textarea' ]) {
    m[t] = new Set(formTags);
  }
  m.option = new Set([ 'option' ]);
  m.optgroup = new Set([ 'optgroup', 'option' ]);
  m.dd = new Set(ddtTags);
  m.dt = new Set(ddtTags);
  for (const t of [
    'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl',
    'fieldset', 'figcaption', 'figure', 'footer', 'form', 'header', 'hr',
    'main', 'nav', 'ol', 'pre', 'section', 'table', 'ul'
  ]) m[t] = new Set(pTag);
  m.rt = new Set(rtpTags);
  m.rp = new Set(rtpTags);
  m.tbody = new Set(tableSectionTags);
  m.tfoot = new Set(tableSectionTags);
  return m;
})();

const WS_RE = /\s/;

// charCode predicates for the tokenizer hot loop — these avoid the per-character
// string allocation of `input[j]` and the regex-engine call. `isWhitespaceCC`
// reproduces JS `/\s/` EXACTLY (ASCII ws incl. VT, plus the Unicode space
// separators and NBSP/BOM), so the conversions stay byte-identical.
function isWhitespaceCC(cc: number): boolean {
  if (cc === 0x20 || (cc >= 0x09 && cc <= 0x0d)) return true;
  if (cc < 0xa0) return false;
  return cc === 0xa0 || cc === 0x1680 || (cc >= 0x2000 && cc <= 0x200a) ||
    cc === 0x2028 || cc === 0x2029 || cc === 0x202f || cc === 0x205f ||
    cc === 0x3000 || cc === 0xfeff;
}
function isNameStartCC(cc: number): boolean { // /[A-Za-z]/
  return (cc >= 0x41 && cc <= 0x5a) || (cc >= 0x61 && cc <= 0x7a);
}
function isTagNameEndCC(cc: number): boolean { // /[\s/>]/
  return cc === 0x2f || cc === 0x3e || isWhitespaceCC(cc);
}
function isAttrNameEndCC(cc: number): boolean { // /[\s/>=]/
  return cc === 0x2f || cc === 0x3e || cc === 0x3d || isWhitespaceCC(cc);
}

interface ParserHandlers {
  onopentag?: (name: string, attribs: Attributes) => void;
  ontext?: (text: string, clean?: boolean) => void;
  onclosetag?: (name: string, isImplied: boolean) => void;
  oncomment?: (text: string) => void;
}

interface RawAttribute {
  name: string;
  value: string;
}

// Shared, never-mutated empty attribute list — lets attribute-less tags (the
// majority: <p>, <li>, <strong>, …) skip allocating a fresh array each.
const EMPTY_RAW_ATTRS: RawAttribute[] = [];

/**
 * Find the end of an HTML comment opened at `openIdx` (`<!--` at openIdx).
 * Mirrors htmlparser2's InCommentLike with sequenceIndex=2 after the opening
 * `--` — supports short comments like `<!-->` as well as `-->`, `--->`, etc.
 * Returns [contentStart, closeGtIdx] or null if unclosed.
 */
function findCommentEnd(input: string, openIdx: number): [number, number] | null {
  const contentStart = openIdx + 4;
  const seq = '-->';
  let seqIdx = 2;
  for (let j = contentStart; j < input.length; j++) {
    const c = input[j];
    if (c === seq[seqIdx]) {
      if (++seqIdx === seq.length) {
        return [contentStart, j];
      }
    } else if (seqIdx === 0) {
      const dash = input.indexOf('-', j);
      if (dash === -1) return null;
      j = dash;
      seqIdx = 1;
    } else if (c !== seq[seqIdx - 1]) {
      seqIdx = 0;
    }
  }
  return null;
}

class Parser {
  private h: ParserHandlers;
  private lowerCaseTags: boolean;
  private lowerCaseAttribs: boolean;
  private decode: boolean;
  private input = '';
  endIndex = -1;
  private stack: string[] = [];

  constructor(handlers: ParserHandlers, opts: ParserOptions = {}) {
    this.h = handlers;
    this.lowerCaseTags = opts.lowerCaseTags !== false;
    this.lowerCaseAttribs = typeof opts.lowerCaseAttributeNames === 'boolean'
      ? opts.lowerCaseAttributeNames
      : this.lowerCaseTags;
    this.decode = opts.decodeEntities !== false;
  }

  private emitText(text: string, decodeOverride?: boolean): void {
    if (!text) return;
    // Clean fast-path: text containing none of `& < >` is untouched by BOTH
    // entity decoding and HTML escaping, so emit it verbatim and tell the
    // handler to skip escapeHtml — one scan instead of decode+escape's two.
    if (!ESCAPE_SCAN.test(text)) {
      if (this.h.ontext) this.h.ontext(text, true);
      return;
    }
    if (this.decode && decodeOverride !== false) text = decodeEntitiesString(text, false);
    if (this.h.ontext) this.h.ontext(text, false);
  }

  private emitOpen(rawName: string, attribs: RawAttribute[], selfClosing: boolean): void {
    const name = this.lowerCaseTags ? rawName.toLowerCase() : rawName;
    if (has(OPEN_IMPLIES_CLOSE, name)) {
      const closers = OPEN_IMPLIES_CLOSE[name];
      while (this.stack.length && closers.has(this.stack[this.stack.length - 1])) {
        const top = this.stack.pop()!;
        if (this.h.onclosetag) this.h.onclosetag(top, true);
      }
    }
    const attrObj: Attributes = {};
    for (const a of attribs) {
      const key = this.lowerCaseAttribs ? a.name.toLowerCase() : a.name;
      if (!(key in attrObj)) {
        // Skip the decode call entirely when there's no `&` to decode.
        const v = a.value;
        attrObj[key] = (this.decode && v.indexOf('&') !== -1)
          ? decodeEntitiesString(v, true) : v;
      }
    }
    if (this.h.onopentag) this.h.onopentag(name, attrObj);
    // Per HTML5, only void tags auto-close on `/>`; the slash on a non-void
    // tag is silently ignored.
    if (VOID_TAGS.has(name)) {
      if (this.h.onclosetag) this.h.onclosetag(name, true);
      return;
    }
    // Inside SVG/MathML (foreign content), `/>` self-closes any element
    // (e.g. `<animate />`), unlike in the HTML namespace.
    if (
      selfClosing &&
      (name === 'svg' || name === 'math' ||
        this.stack.indexOf('svg') !== -1 || this.stack.indexOf('math') !== -1)
    ) {
      if (this.h.onclosetag) this.h.onclosetag(name, false);
      return;
    }
    this.stack.push(name);
  }

  private emitClose(rawName: string, isImplied: boolean): void {
    const name = this.lowerCaseTags ? rawName.toLowerCase() : rawName;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i] === name) {
        while (this.stack.length > i + 1) {
          const top = this.stack.pop()!;
          if (this.h.onclosetag) this.h.onclosetag(top, true);
        }
        this.stack.pop();
        if (this.h.onclosetag) this.h.onclosetag(name, !!isImplied);
        return;
      }
    }
    // Tag not on stack. htmlparser2 synthesizes an element for two cases:
    //   </p>  with no open <p>  → an empty <p></p>
    //   </br>                   → <br />
    if (name === 'p') {
      this.emitOpen('p', [], false); // opens & pushes <p>
      this.emitClose('p', true); // immediately closes it
    } else if (name === 'br') {
      this.emitOpen('br', [], false); // br is void → emits <br /> and self-closes
    }
    // Any other unmatched close tag is dropped.
  }

  write(chunk: string): void {
    this.input += chunk;
  }

  end(): void {
    this.parse();
    while (this.stack.length) {
      const top = this.stack.pop()!;
      if (this.h.onclosetag) this.h.onclosetag(top, true);
    }
  }

  /** Single-pass tokenizer. Sets `endIndex` as it goes. */
  private parse(): void {
    const input = this.input;
    const len = input.length;
    let i = 0;
    let textStart = 0;
    this.endIndex = -1;
    // Lazily lower-cased copy of the whole input, used only to find raw-text
    // close tags. Computed at most once per parse (not once per <script>/<style>).
    let lowerInputCache: string | null = null;

    const flushText = (until: number, decode?: boolean) => {
      if (until > textStart) {
        const text = input.substring(textStart, until);
        this.emitText(text, decode);
        this.endIndex = until;
      }
      textStart = until;
    };

    while (i < len) {
      // Jump to the next `<` with a native (SIMD-optimized) indexOf instead of a
      // manual per-char loop — a big win for long plain-text runs.
      if (input.charCodeAt(i) !== 0x3c) {
        const lt = input.indexOf('<', i + 1);
        if (lt === -1) break;
        i = lt;
      }
      const nextCC = input.charCodeAt(i + 1); // 0x21=! 0x3f=? 0x2f=/ 0x2d=-
      // Comment <!-- ... --> — htmlparser2 sequence match (not naive indexOf).
      if (nextCC === 0x21 && input.charCodeAt(i + 2) === 0x2d && input.charCodeAt(i + 3) === 0x2d) {
        flushText(i);
        const end = findCommentEnd(input, i);
        if (!end) return;
        const [contentStart, closeGt] = end;
        if (this.h.oncomment) this.h.oncomment(input.substring(contentStart, closeGt - 2));
        i = closeGt + 1;
        textStart = i;
        this.endIndex = i;
        continue;
      }
      // CDATA section <![CDATA[ ... ]]> — discarded in HTML mode (htmlparser2
      // treats it like a comment ending at ]]>, so its contents never leak).
      if (nextCC === 0x21 && input.substring(i + 2, i + 9) === '[CDATA[') {
        flushText(i);
        const end = input.indexOf(']]>', i + 9);
        if (end === -1) return;
        i = end + 3;
        textStart = i;
        this.endIndex = i;
        continue;
      }
      // DOCTYPE / processing instruction / bogus <!…> declarations.
      // Mirrors htmlparser2: `<!--` is handled above; a lone `<!-` (not `<!--`)
      // emits the tail as text; `<!>` emits `>`; `<!-x>` is a silent declaration.
      if (nextCC === 0x21 || nextCC === 0x3f) {
        flushText(i);
        if (nextCC === 0x3f) {
          const end = input.indexOf('>', i + 2);
          if (end === -1) { i += 2; textStart = i; continue; }
          i = end + 1;
          textStart = i;
          this.endIndex = i;
          continue;
        }
        const c2 = input.charCodeAt(i + 2);
        if (c2 === 0x2d) {
          const c3 = input.charCodeAt(i + 3);
          if (c3 === 0x3e || c3 === undefined || Number.isNaN(c3)) {
            i += 2;
            textStart = i;
            this.endIndex = i;
            continue;
          }
          const end = input.indexOf('>', i + 2);
          if (end === -1) { i += 2; textStart = i; continue; }
          i = end + 1;
          textStart = i;
          this.endIndex = i;
          continue;
        }
        if (c2 === 0x3e) {
          i += 2;
          textStart = i;
          this.endIndex = i;
          continue;
        }
        const end = input.indexOf('>', i + 2);
        if (end === -1) { i += 2; textStart = i; continue; }
        i = end + 1;
        textStart = i;
        this.endIndex = i;
        continue;
      }
      // Closing tag </name>. Mirror htmlparser2's "before closing tag name":
      // skip whitespace, then `>` emits the run as text, a letter starts the
      // name, and anything else is a bogus comment (discarded to `>`).
      if (nextCC === 0x2f) {
        flushText(i);
        let j = i + 2;
        while (j < len && isWhitespaceCC(input.charCodeAt(j))) j++;
        const c = input[j];
        if (c === undefined) {
          this.emitText(input.substring(i), false); // `</` at EOF → literal text
          this.endIndex = len;
          textStart = len;
          return;
        }
        if (c === '>') {
          // `</>` / `</ >` → the whole run is emitted as literal text.
          this.emitText(input.substring(i, j + 1), false);
          i = j + 1;
          textStart = i;
          this.endIndex = i;
          continue;
        }
        if (!isNameStartCC(c.charCodeAt(0))) {
          // Bogus comment (e.g. `</1>`, `</!>`) — discard through `>`.
          const end = input.indexOf('>', j);
          if (end === -1) return;
          i = end + 1;
          textStart = i;
          this.endIndex = i;
          continue;
        }
        const nameStart = j;
        while (j < len && !isTagNameEndCC(input.charCodeAt(j))) j++;
        const nameEnd = j;
        while (j < len && input[j] !== '>') j++;
        if (j >= len) return;
        const rawName = input.substring(nameStart, nameEnd);
        this.emitClose(rawName, false);
        i = j + 1;
        textStart = i;
        this.endIndex = i;
        continue;
      }
      // Opening tag <name ...>  (charCodeAt is NaN past EOF, so a trailing `<`
      // falls through to the stray-`<` handler, matching the old undefined check)
      if (isNameStartCC(input.charCodeAt(i + 1))) {
        flushText(i);
        const tokenStart = i;
        let j = i + 1;
        const nameStart = j;
        // Tag name runs until whitespace, `/`, or `>` (matching htmlparser2);
        // it may contain `:`, `-`, `<`, etc. (e.g. `media:content`, `rdf:RDF`).
        while (j < len && !isTagNameEndCC(input.charCodeAt(j))) j++;
        const rawName = input.substring(nameStart, j);
        let attribs: RawAttribute[] = EMPTY_RAW_ATTRS; // lazily allocated on first attr
        let selfClosing = false;
        let finished = false;
        while (j < len) {
          while (j < len && isWhitespaceCC(input.charCodeAt(j))) j++;
          if (j >= len) break;
          const c = input[j];
          if (c === '>') { j++; finished = true; break; }
          if (c === '/') {
            j++;
            while (j < len && isWhitespaceCC(input.charCodeAt(j))) j++;
            if (input[j] === '>') {
              selfClosing = true; j++; finished = true; break;
            }
            continue;
          }
          const attrNameStart = j;
          while (j < len && !isAttrNameEndCC(input.charCodeAt(j))) j++;
          let attrName = input.substring(attrNameStart, j);
          // htmlparser2 treats a lone `=` as an attribute name (`<a ==b>` → { '=': 'b' }).
          if (!attrName && input[j] === '=') {
            attrName = '=';
            j++;
          }
          if (!attrName) {
            j++;
            continue;
          }
          while (j < len && isWhitespaceCC(input.charCodeAt(j))) j++;
          let attrValue = '';
          if (input[j] === '=') {
            j++;
            while (j < len && isWhitespaceCC(input.charCodeAt(j))) j++;
            if (input[j] === '"' || input[j] === "'") {
              const q = input[j];
              j++;
              const valStart = j;
              // Native scan to the closing quote (faster than a manual loop for
              // long values like URLs / data URIs).
              const close = input.indexOf(q, j);
              j = close === -1 ? len : close;
              attrValue = input.substring(valStart, j);
              if (j < len) j++; // skip the closing quote
            } else {
              const valStart = j;
              let vcc: number;
              while (j < len && (vcc = input.charCodeAt(j)) !== 0x3e && !isWhitespaceCC(vcc)) j++;
              attrValue = input.substring(valStart, j);
            }
          }
          if (attribs === EMPTY_RAW_ATTRS) attribs = [];
          attribs.push({ name: attrName, value: attrValue });
        }
        if (!finished) {
          // Match htmlparser2 quirk: emit any `/` chars in the unfinished tag
          // as text. (e.g. `<div/` produces a `/` text event.)
          const unfinished = input.substring(tokenStart, len);
          if (unfinished.indexOf('/') !== -1) {
            const slashCount = (unfinished.match(/\//g) || []).length;
            for (let s = 0; s < slashCount; s++) this.emitText('/', false);
            this.endIndex = len;
            textStart = len;
            return;
          }
          textStart = tokenStart;
          return;
        }
        this.emitOpen(rawName, attribs, selfClosing);
        i = j;
        textStart = i;
        this.endIndex = i;

        const rawNameLower = rawName.toLowerCase();
        const tagNameNorm = this.lowerCaseTags ? rawNameLower : rawName;
        if (!selfClosing && !VOID_TAGS.has(tagNameNorm) && RAW_TEXT_TAGS.has(rawNameLower)) {
          // htmlparser2 decodes entities inside <title> (RCDATA) only.
          const decodeRaw = RCDATA_DECODE_TAGS.has(rawNameLower);
          const lowerInput = lowerInputCache ?? (lowerInputCache = input.toLowerCase());
          const closeNeedle = '</' + rawNameLower;
          let searchFrom = i;
          let found = -1;
          while (true) {
            const idx = lowerInput.indexOf(closeNeedle, searchFrom);
            if (idx === -1) break;
            const after = input.charAt(idx + closeNeedle.length);
            if (after === '' || after === '>' || after === '/' || WS_RE.test(after)) {
              found = idx;
              break;
            }
            searchFrom = idx + 1;
          }
          if (found === -1) {
            const raw = input.substring(i);
            if (raw) this.emitText(raw, decodeRaw);
            this.endIndex = len;
            if (this.stack[this.stack.length - 1] === tagNameNorm) {
              this.stack.pop();
              if (this.h.onclosetag) this.h.onclosetag(tagNameNorm, true);
            }
            i = len;
            textStart = i;
            continue;
          }
          if (found > i) {
            const raw = input.substring(i, found);
            this.emitText(raw, decodeRaw);
          }
          let k = found + closeNeedle.length;
          while (k < len && input[k] !== '>') k++;
          if (k >= len) {
            textStart = found;
            return;
          }
          this.emitClose(rawNameLower, false);
          i = k + 1;
          textStart = i;
          this.endIndex = i;
          continue;
        }
        continue;
      }
      // Stray `<` — emit as text, advance one char, keep parsing.
      flushText(i);
      this.emitText('<', false);
      i++;
      textStart = i;
      this.endIndex = i;
    }
    if (textStart < len) {
      const text = input.substring(textStart);
      this.emitText(text);
      this.endIndex = len;
    } else if (this.endIndex < 0) {
      this.endIndex = textStart;
    }
  }
}

// =============================================================================
// URL safety helper (replaces launder.naughtyHref)
// =============================================================================

// Fast-path scans for escapeHtml: only allocate when something needs escaping.
const ESCAPE_SCAN = /[&<>]/;
const ESCAPE_SCAN_Q = /[&<>"]/;

// Base URL for parseUrl's relative-URL detection. The long, constant path-segment
// list is built once at module load instead of on every parseUrl call.
const PARSE_URL_BASE = (() => {
  let base = 'relative://relative-site';
  for (let i = 0; i < 100; i++) base += `/${i}`;
  return base;
})();

// eslint-disable-next-line no-control-regex
const HREF_CONTROL_CHARS_G = /[\x00-\x20]+/g;
// Hoisted (like HREF_CONTROL_CHARS_G) so naughtyHrefImpl doesn't re-create a
// RegExp wrapper per href. Both non-global → no lastIndex state to share.
const HREF_SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9.\-+]*):/;
const HREF_PROTOCOL_REL_RE = /^[/\\]{2}/;

function cleanHref(href: string): string {
  href = href.replace(HREF_CONTROL_CHARS_G, '');
  let firstIndex = href.indexOf('<!--');
  while (firstIndex !== -1) {
    const lastIndex = href.indexOf('-->', firstIndex + 4);
    if (lastIndex === -1) break;
    href = href.substring(0, firstIndex) + href.substring(lastIndex + 3);
    firstIndex = href.indexOf('<!--');
  }
  return href;
}

interface NaughtyHrefOptions {
  allowedSchemes?: string[];
  allowProtocolRelative?: boolean;
}

function naughtyHrefImpl(
  href: unknown,
  options: NaughtyHrefOptions = {}
): boolean {
  const allowedSchemes = options.allowedSchemes ||
    [ 'http', 'https', 'ftp', 'mailto', 'tel', 'sms' ];
  const allowProtocolRelative = options.allowProtocolRelative !== false;
  if (typeof href !== 'string') return false;
  href = cleanHref(href);
  const matches = (href as string).match(HREF_SCHEME_RE);
  if (!matches) {
    if (HREF_PROTOCOL_REL_RE.test(href as string)) return !allowProtocolRelative;
    return false;
  }
  const scheme = matches[1].toLowerCase();
  return allowedSchemes.indexOf(scheme) === -1;
}

// =============================================================================
// srcset parser (replaces parse-srcset)
// =============================================================================

interface SrcsetEntry {
  url: string;
  w?: number;
  h?: number;
  d?: number;
  evil?: boolean;
}

// parse-srcset uses the WHATWG ASCII whitespace set, NOT JS `\s` (which also
// matches U+00A0 etc.) — so e.g. `&nbsp;` stays part of a candidate URL.
const SRCSET_WS = /[\t\n\f\r ]/;
// Mirrors parse-srcset@1.0.2 descriptor validation exactly.
const SRCSET_NON_NEG_INT = /^\d+$/;
const SRCSET_FLOAT = /^-?(?:[0-9]+|[0-9]*\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

function parseSrcset(input: string): SrcsetEntry[] {
  // Faithful port of parse-srcset@1.0.2 (used by sanitize-html).
  const candidates: SrcsetEntry[] = [];
  const inputLength = input.length;
  let pos = 0;

  const isSpace = (c: string) =>
    c === '\u0020' || c === '\u0009' || c === '\u000A' || c === '\u000C' || c === '\u000D';

  const collectLeading = (re: RegExp): string => {
    const m = re.exec(input.substring(pos));
    if (m) {
      const chars = m[0];
      pos += chars.length;
      return chars;
    }
    return '';
  };

  const parseDescriptors = (url: string, descriptors: string[]): void => {
    let pError = false;
    let w: number | undefined;
    let d: number | undefined;
    let h: number | undefined;
    const entry: SrcsetEntry = { url };

    for (let di = 0; di < descriptors.length; di++) {
      const desc = descriptors[di];
      const lastChar = desc[desc.length - 1];
      const value = desc.substring(0, desc.length - 1);
      const intVal = parseInt(value, 10);
      const floatVal = parseFloat(value);
      if (SRCSET_NON_NEG_INT.test(value) && lastChar === 'w') {
        if (w != null || d != null) pError = true;
        else if (intVal === 0) pError = true;
        else w = intVal;
      } else if (SRCSET_FLOAT.test(value) && lastChar === 'x') {
        if (w != null || d != null || h != null) pError = true;
        else if (floatVal < 0) pError = true;
        else d = floatVal;
      } else if (SRCSET_NON_NEG_INT.test(value) && lastChar === 'h') {
        if (h != null || d != null) pError = true;
        else if (intVal === 0) pError = true;
        else h = intVal;
      } else {
        pError = true;
      }
    }

    if (!pError) {
      if (w != null) entry.w = w;
      if (d != null) entry.d = d;
      if (h != null) entry.h = h;
      candidates.push(entry);
    } else if (typeof console !== 'undefined' && console.log) {
      const bad = descriptors.find((desc) => {
        const lastChar = desc[desc.length - 1];
        const value = desc.substring(0, desc.length - 1);
        const intVal = parseInt(value, 10);
        const floatVal = parseFloat(value);
        if (SRCSET_NON_NEG_INT.test(value) && lastChar === 'w') return intVal === 0;
        if (SRCSET_FLOAT.test(value) && lastChar === 'x') return floatVal < 0;
        if (SRCSET_NON_NEG_INT.test(value) && lastChar === 'h') return intVal === 0;
        return true;
      }) ?? descriptors[descriptors.length - 1];
      console.log(`Invalid srcset descriptor found in '${input}' at '${bad}'.`);
    }
  };

  const tokenize = (url: string): void => {
    const descriptors: string[] = [];
    let currentDescriptor = '';
    let state: 'in descriptor' | 'in parens' | 'after descriptor' = 'in descriptor';

    while (true) {
      const c = pos < inputLength ? input[pos] : '';
      if (state === 'in descriptor') {
        if (isSpace(c)) {
          if (currentDescriptor) {
            descriptors.push(currentDescriptor);
            currentDescriptor = '';
            state = 'after descriptor';
          }
        } else if (c === ',') {
          pos++;
          if (currentDescriptor) descriptors.push(currentDescriptor);
          parseDescriptors(url, descriptors);
          return;
        } else if (c === '(') {
          currentDescriptor += c;
          state = 'in parens';
        } else if (c === '') {
          if (currentDescriptor) descriptors.push(currentDescriptor);
          parseDescriptors(url, descriptors);
          return;
        } else {
          currentDescriptor += c;
        }
      } else if (state === 'in parens') {
        if (c === ')') {
          currentDescriptor += c;
          state = 'in descriptor';
        } else if (c === '') {
          descriptors.push(currentDescriptor);
          parseDescriptors(url, descriptors);
          return;
        } else {
          currentDescriptor += c;
        }
      } else if (state === 'after descriptor') {
        if (isSpace(c)) {
          // stay
        } else if (c === '') {
          parseDescriptors(url, descriptors);
          return;
        } else {
          state = 'in descriptor';
          pos--;
        }
      }
      pos++;
    }
  };

  while (true) {
    collectLeading(/^[, \t\n\r\u000c]+/);
    if (pos >= inputLength) return candidates;

    const urlMatch = /^[^ \t\n\r\u000c]+/.exec(input.substring(pos));
    if (!urlMatch) return candidates;
    let url = urlMatch[0];
    pos += url.length;

    const descriptors: string[] = [];
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      parseDescriptors(url, descriptors);
    } else {
      tokenize(url);
    }
  }
}

function stringifySrcset(parsed: SrcsetEntry[]): string {
  return parsed.map((part) => {
    if (!part.url) throw new Error('URL missing');
    return (
      part.url +
      (part.w ? ` ${part.w}w` : '') +
      (part.h ? ` ${part.h}h` : '') +
      (part.d ? ` ${part.d}x` : '')
    );
  }).join(', ');
}

// =============================================================================
// Style attribute parser (replaces postcss)
// =============================================================================

interface StyleDecl {
  // `undefined` for postcss comment nodes, which stringify as `undefined:undefined`.
  prop?: string;
  value?: string;
  important: boolean;
}

interface StyleRule {
  selector: string;
  nodes: StyleDecl[];
}

interface StyleAst {
  nodes: StyleRule[];
}

/** Remove `/* ... *​/` comments from a string, leaving quoted strings intact. */
function stripStyleComments(s: string): string {
  if (s.indexOf('/*') === -1) return s;
  let out = '';
  let k = 0;
  let str: string | null = null;
  while (k < s.length) {
    const c = s[k];
    if (str) {
      if (c === '\\') { out += s.slice(k, k + 2); k += 2; continue; }
      if (c === str) str = null;
      out += c; k++;
      continue;
    }
    if (c === '"' || c === "'") { str = c; out += c; k++; continue; }
    if (c === '/' && s[k + 1] === '*') {
      const end = s.indexOf('*/', k + 2);
      k = (end === -1 ? s.length : end + 2);
    } else {
      out += c; k++;
    }
  }
  return out;
}

/**
 * Parse an inline `style` value into declarations, reproducing the observable
 * behaviour of the original sanitize-html's postcss-based parser:
 *   - property names keep their original case (so case-sensitive `allowedStyles`
 *     allowlists are honoured — `COLOR` does not match a `color` rule);
 *   - `/* *​/` comments are stripped; `!important` is recognised with flexible
 *     whitespace; empty values (`color:`) are preserved;
 *   - malformed CSS that postcss rejects (unterminated string/comment/paren,
 *     a trailing `\`, or stray braces) throws, so the caller drops the whole
 *     attribute rather than keeping a partial parse.
 */
function parseStyleAst(name: string, value: string): StyleAst {
  const decls: StyleDecl[] = [];
  const len = value.length;
  let i = 0;
  while (i < len) {
    // Scan one declaration up to the next top-level `;`, tracking strings,
    // parentheses, escapes and comments. Record the first top-level `:`, the
    // top-level comment ranges, and the bounds of the "real" (non-comment,
    // non-whitespace) content so we can reproduce postcss's comment nodes.
    let depth = 0;
    let str: string | null = null;
    let colon = -1;
    let firstReal = -1;
    let lastReal = -1;
    const comments: Array<[number, number]> = [];
    const markReal = (from: number, to: number) => {
      if (firstReal === -1) firstReal = from;
      lastReal = to;
    };
    while (i < len) {
      const c = value[i];
      if (str) {
        if (c === '\\') { markReal(i, i + 2); i += 2; continue; }
        if (c === str) str = null;
        markReal(i, i + 1);
        i++;
        continue;
      }
      if (c === '\\') {
        if (i + 1 >= len) throw new Error('Unexpected trailing backslash');
        markReal(i, i + 2);
        i += 2; // escaped char is part of the value (e.g. `\;`)
        continue;
      }
      if (c === '"' || c === "'") { str = c; markReal(i, i + 1); i++; continue; }
      if (c === '/' && value[i + 1] === '*') {
        const end = value.indexOf('*/', i + 2);
        if (end === -1) throw new Error('Unclosed comment');
        comments.push([i, end + 2]);
        i = end + 2;
        continue;
      }
      if (c === '(') { depth++; markReal(i, i + 1); i++; continue; }
      if (c === ')') { if (depth > 0) depth--; markReal(i, i + 1); i++; continue; }
      // Real inline styles never contain braces; postcss treats these as rule
      // boundaries (and throws on a stray `}`). Dropping the attribute is the
      // safe, simplest match.
      if (c === '{' || c === '}') throw new Error('Unexpected brace in style');
      if (c === ';' && depth === 0) break;
      if (c === ':' && depth === 0 && colon === -1) {
        // The first top-level `:` separates prop from value; it is not "real"
        // content, so an empty value (`color:`) is detected correctly. Later
        // colons (e.g. IE `filter: progid:…`) are part of the value.
        colon = i;
        i++;
        continue;
      }
      if (!WS_RE.test(c)) markReal(i, i + 1);
      i++;
    }
    if (str !== null) throw new Error('Unclosed string');
    if (depth > 0) throw new Error('Unclosed bracket');
    if (i < len) i++; // consume `;`

    // A segment with no real content is just comments/whitespace: postcss emits
    // a comment node for each comment (rendered as `undefined:undefined`).
    if (firstReal === -1) {
      for (let n = 0; n < comments.length; n++) decls.push({ important: false });
      continue;
    }
    // Comments before the first real char are standalone leading comment nodes.
    for (const [s] of comments) if (s < firstReal) decls.push({ important: false });

    if (colon === -1 || colon < firstReal) throw new Error('Missing colon in declaration');

    const prop = stripStyleComments(value.substring(firstReal, colon)).trim();
    if (prop === '' || /\s/.test(prop)) throw new Error('Invalid property name');

    // Value spans to the last real char (empty when the only content after the
    // colon is comments/whitespace). Internal comments are stripped; trailing
    // comments after a non-empty value become their own nodes.
    const hasValue = lastReal > colon;
    let val = stripStyleComments(value.substring(colon + 1, hasValue ? lastReal : colon + 1))
      .replace(/^\s+|\s+$/g, '');
    let important = false;
    const impMatch = val.match(/!\s*important\s*$/i);
    if (impMatch) {
      important = true;
      val = val.slice(0, impMatch.index).replace(/\s+$/, '');
    }
    decls.push({ prop, value: val, important });

    if (hasValue) {
      for (const [s] of comments) if (s >= lastReal) decls.push({ important: false });
    }
  }
  return { nodes: [ { selector: name, nodes: decls } ] };
}

// =============================================================================
// Main sanitizer
// =============================================================================

const mediaTags = [
  'img', 'audio', 'video', 'picture', 'svg',
  'object', 'map', 'iframe', 'embed'
];
const vulnerableTags = [ 'script', 'style' ];

const VALID_HTML_ATTRIBUTE_NAME = /^[^\0\t\n\f\r /<=>]+$/;
/**
 * Fast equivalent of `VALID_HTML_ATTRIBUTE_NAME.test(a)`, valid ONLY for names
 * produced by this file's parser. The parser's attr-name scan (`isAttrNameEndCC`)
 * already stops at `/ > =` and every whitespace char, so a parser name can never
 * contain 8 of the regex's 10 forbidden chars — only `\0` and `<` remain to
 * reject (plus the non-empty requirement). One charCode pass with two compares
 * beats entering the regex engine. MUST NOT be used on names that bypass the
 * parser scan (transform- or onOpenTag-injected) — `compileOptions` gates this
 * behind `parserCleanAttrNames`, and `test/attr-name-fast.test.ts` fuzz-proves
 * the equivalence end-to-end against the original.
 */
function isAttrNameParserClean(a: string): boolean {
  if (a.length === 0) return false;
  for (let i = 0; i < a.length; i++) {
    const c = a.charCodeAt(i);
    // Mirror VALID_HTML_ATTRIBUTE_NAME — parser now allows `=` in names (htmlparser2
    // parity) but the sanitizer must still reject them.
    if (c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32 ||
        c === 47 || c === 60 || c === 61 || c === 62) return false;
  }
  return true;
}

const htmlParserDefaults: ParserOptions = {
  decodeEntities: true
};

// Stateless helpers (no per-document state) — hoisted to module scope so they
// are defined once rather than recreated on every sanitize() call.

interface ParsedUrlResult {
  isRelativeUrl: boolean;
  url: URL;
}

function parseUrl(value: string): ParsedUrlResult {
  value = value.replace(/^(\w+:)?\s*[\\/]\s*[\\/]/, '$1//');
  if (value.startsWith('relative:')) {
    throw new Error('relative: exploit attempt');
  }
  const parsed = new URL(value, PARSE_URL_BASE);
  const isRelativeUrl = !!parsed && parsed.hostname === 'relative-site' && parsed.protocol === 'relative:';
  return { isRelativeUrl, url: parsed };
}

function filterDeclarations(selectedRule: Record<string, RegExp[]>) {
  return (acc: StyleDecl[], decl: StyleDecl): StyleDecl[] => {
    // Comment nodes (undefined prop) are dropped once an allowlist applies.
    if (decl.prop !== undefined && has(selectedRule, decl.prop)) {
      const matchesRegex = selectedRule[decl.prop].some((re) => re.test(decl.value ?? ''));
      if (matchesRegex) acc.push(decl);
    }
    return acc;
  };
}

function filterCss(ast: StyleAst, allowedStyles: AllowedStyles | undefined): StyleAst {
  if (!allowedStyles) return ast;
  const astRules = ast.nodes[0];
  let selectedRule: Record<string, RegExp[]> | undefined;
  if (allowedStyles[astRules.selector] && allowedStyles['*']) {
    selectedRule = deepmerge(
      allowedStyles[astRules.selector],
      allowedStyles['*']
    ) as Record<string, RegExp[]>;
  } else {
    selectedRule = allowedStyles[astRules.selector] || allowedStyles['*'];
  }
  if (selectedRule) {
    ast.nodes[0].nodes = astRules.nodes.reduce(filterDeclarations(selectedRule), [] as StyleDecl[]);
  }
  return ast;
}

function stringifyStyleAttributes(filteredAst: StyleAst): string {
  return filteredAst.nodes[0].nodes
    .reduce<string[]>((acc, decl) => {
      acc.push(`${decl.prop}:${decl.value}${decl.important ? ' !important' : ''}`);
      return acc;
    }, [])
    .join(';');
}

function filterClasses(
  classes: string,
  allowed: string[] | false | undefined,
  allowedGlobs: RegExp[]
): string {
  if (!allowed) return classes;
  return classes.split(/\s+/).filter((clss) => {
    return allowed.indexOf(clss) !== -1 ||
      allowedGlobs.some((glob) => glob.test(clss));
  }).join(' ');
}

interface Frame {
  tag: string;
  attribs: Attributes;
  tagPosition: number;
  text: string;
  openingTagLength: number;
  mediaChildren: string[];
  innerText?: string;
  name?: string;
}

// Hoisted out of `makeFrame` so each frame stays a closure-free plain object.
function updateParentNodeText(stack: Frame[], frame: Frame): void {
  if (stack.length) {
    stack[stack.length - 1].text += frame.text;
  }
}
function updateParentNodeMediaChildren(stack: Frame[], frame: Frame): void {
  if (stack.length && mediaTags.includes(frame.tag)) {
    stack[stack.length - 1].mediaChildren.push(frame.tag);
  }
}

/**
 * Everything derived purely from `options` — resolved option set plus the
 * compiled allow-list maps. Building this is the expensive part, so a `Sanitizer`
 * does it once and reuses it across every `sanitize()` call.
 */
interface CompiledOptions {
  opts: Required<Defaults> & IOptions;
  nonTextTagsArray: string[];
  allowedAttributesMap: Record<string, AllowedAttribute[]> | undefined;
  allowedAttributesGlobMap: Record<string, RegExp> | undefined;
  allowedClassesMap: Record<string, string[] | false>;
  allowedClassesGlobMap: Record<string, RegExp>;
  allowedClassesRegexMap: Record<string, RegExp[]>;
  transformTagsMap: Record<string, Transformer>;
  transformTagsAll: Transformer | undefined;
  hasTransformTags: boolean;
  // Precompiled membership sets (built once) to replace per-tag/per-attribute
  // linear array scans. `allowedTagsSet` is null when allowedTags is `false` or
  // a string (the latter keeps the original substring `indexOf` semantics).
  allowedTagsSet: Set<string> | null;
  schemeAttrSet: Set<string>;
  emptyAttrSet: Set<string>;
  nonBooleanAttrSet: Set<string>;
  nonBooleanAttrStar: boolean;
  selfClosingSet: Set<string>;
  // `disallowedTagsMode` is a per-run constant, yet the handlers compared it
  // against string literals on every tag/text node. Resolve those compares once
  // here so the hot paths read a boolean. (`modeEscapeOrRecursive` also kills a
  // per-close-tag `['escape','recursiveEscape'].indexOf(...)` array allocation.)
  modeDiscardOrCompletely: boolean;
  modeCompletelyDiscard: boolean;
  modeEscapeOrRecursive: boolean;
  modeRecursiveEscape: boolean;
  // True when every attribute name reaching validation is parser-produced (no
  // transform/onOpenTag injection), so the fast `isAttrNameParserClean` may
  // replace the `VALID_HTML_ATTRIBUTE_NAME` regex byte-identically.
  parserCleanAttrNames: boolean;
}

function compileOptions(options?: IOptions): CompiledOptions {
  const opts: Required<Defaults> & IOptions =
    Object.assign({}, sanitizeHtmlFn.defaults, options) as Required<Defaults> & IOptions;
  opts.parser = Object.assign({}, htmlParserDefaults, opts.parser);

  const nonTextTagsArray = opts.nonTextTags || [
    'script', 'style', 'textarea', 'option', 'xmp'
  ];

  let allowedAttributesMap: Record<string, AllowedAttribute[]> | undefined;
  let allowedAttributesGlobMap: Record<string, RegExp> | undefined;
  if (opts.allowedAttributes) {
    allowedAttributesMap = {};
    allowedAttributesGlobMap = {};
    each(opts.allowedAttributes as Record<string, AllowedAttribute[]>, (attributes, tag) => {
      allowedAttributesMap![tag] = [];
      const globRegex: string[] = [];
      attributes.forEach((obj) => {
        if (typeof obj === 'string' && obj.indexOf('*') >= 0) {
          globRegex.push(escapeStringRegexp(obj).replace(/\\\*/g, '.*'));
        } else {
          allowedAttributesMap![tag].push(obj);
        }
      });
      if (globRegex.length) {
        allowedAttributesGlobMap![tag] = new RegExp('^(' + globRegex.join('|') + ')$');
      }
    });
  }

  const allowedClassesMap: Record<string, string[] | false> = {};
  const allowedClassesGlobMap: Record<string, RegExp> = {};
  const allowedClassesRegexMap: Record<string, RegExp[]> = {};
  each(opts.allowedClasses, (classes, tag) => {
    if (allowedAttributesMap) {
      if (!has(allowedAttributesMap, tag)) {
        allowedAttributesMap[tag] = [];
      }
      allowedAttributesMap[tag].push('class');
    }
    allowedClassesMap[tag] = classes as string[] | false;
    if (Array.isArray(classes)) {
      const globRegex: string[] = [];
      allowedClassesMap[tag] = [];
      allowedClassesRegexMap[tag] = [];
      classes.forEach((obj) => {
        if (typeof obj === 'string' && obj.indexOf('*') >= 0) {
          globRegex.push(escapeStringRegexp(obj).replace(/\\\*/g, '.*'));
        } else if (obj instanceof RegExp) {
          allowedClassesRegexMap[tag].push(obj);
        } else {
          (allowedClassesMap[tag] as string[]).push(obj as string);
        }
      });
      if (globRegex.length) {
        allowedClassesGlobMap[tag] = new RegExp('^(' + globRegex.join('|') + ')$');
      }
    }
  });

  const transformTagsMap: Record<string, Transformer> = {};
  let transformTagsAll: Transformer | undefined;
  each(opts.transformTags, (transform, tag) => {
    let transFun: Transformer | undefined;
    if (typeof transform === 'function') {
      transFun = transform as Transformer;
    } else if (typeof transform === 'string') {
      transFun = sanitizeHtmlFn.simpleTransform(transform);
    }
    if (!transFun) return;
    if (tag === '*') transformTagsAll = transFun;
    else transformTagsMap[tag] = transFun;
  });

  const allowedTagsSet = Array.isArray(opts.allowedTags) ? new Set(opts.allowedTags) : null;
  const schemeAttrSet = new Set(opts.allowedSchemesAppliedToAttributes);
  const emptyAttrSet = new Set(opts.allowedEmptyAttributes);
  const nonBooleanAttrSet = new Set(opts.nonBooleanAttributes);
  const nonBooleanAttrStar = nonBooleanAttrSet.has('*');
  const selfClosingSet = new Set(opts.selfClosing);
  const hasTransformTags = Object.keys(transformTagsMap).length > 0;

  const dm = opts.disallowedTagsMode;
  const modeCompletelyDiscard = dm === 'completelyDiscard';
  const modeDiscardOrCompletely = dm === 'discard' || modeCompletelyDiscard;
  const modeRecursiveEscape = dm === 'recursiveEscape';
  const modeEscapeOrRecursive = dm === 'escape' || modeRecursiveEscape;

  // The fast attr-name validator is only sound when no callback can inject an
  // attribute name that skipped the parser's scan: `transformTags` (per-tag or
  // `*`) returning fresh attribs, or `onOpenTag` mutating them. None present →
  // every validated name is parser-clean.
  const parserCleanAttrNames = !opts.onOpenTag && !hasTransformTags && !transformTagsAll;

  return {
    opts, nonTextTagsArray,
    allowedAttributesMap, allowedAttributesGlobMap,
    allowedClassesMap, allowedClassesGlobMap, allowedClassesRegexMap,
    transformTagsMap, transformTagsAll, hasTransformTags,
    allowedTagsSet, schemeAttrSet, emptyAttrSet, nonBooleanAttrSet, nonBooleanAttrStar,
    selfClosingSet,
    modeDiscardOrCompletely, modeCompletelyDiscard, modeEscapeOrRecursive, modeRecursiveEscape,
    parserCleanAttrNames
  };
}

/**
 * A sanitizer bound to a fixed set of options. Compile the options once, then
 * call `sanitize()` as many times as you like — ideal for hot paths that reuse
 * the same configuration across many documents.
 */
class Sanitizer {
  private readonly compiled: CompiledOptions;

  constructor(options?: IOptions) {
    this.compiled = compileOptions(options);
  }

  sanitize(html: string | number | null | undefined): string {
  if (html == null) return '';
  if (typeof html === 'number') html = html.toString();
  const inputHtml = html as string;

  let result = '';
  let tempResult = '';

  const {
    opts, nonTextTagsArray,
    allowedAttributesMap, allowedAttributesGlobMap,
    allowedClassesMap, allowedClassesGlobMap, allowedClassesRegexMap,
    transformTagsMap, transformTagsAll, hasTransformTags,
    allowedTagsSet, schemeAttrSet, emptyAttrSet, nonBooleanAttrSet, nonBooleanAttrStar,
    selfClosingSet,
    modeDiscardOrCompletely, modeCompletelyDiscard, modeEscapeOrRecursive, modeRecursiveEscape,
    parserCleanAttrNames
  } = this.compiled;

  function makeFrame(tag: string, attribs: Attributes): Frame {
    // Plain data object with a stable shape and NO per-frame closures (the
    // parent-update helpers are hoisted to module scope) — much less GC churn
    // on tag-dense documents.
    return {
      tag,
      attribs: attribs || {},
      tagPosition: result.length,
      text: '',
      openingTagLength: 0,
      mediaChildren: []
    };
  }

  const tagAllowed = (name: string | undefined): boolean => {
    if (opts.allowedTags === false) return true;
    if (allowedTagsSet) return allowedTagsSet.has(name as string);
    // Non-array allowedTags (e.g. a string) keeps the original indexOf behaviour.
    return ((opts.allowedTags as string[] | undefined) || []).indexOf(name as string) > -1;
  };

  vulnerableTags.forEach((tag) => {
    if (tagAllowed(tag) && !opts.allowVulnerableTags) {
      // eslint-disable-next-line no-console
      console.warn(`\n\n⚠️ Your \`allowedTags\` option includes, \`${tag}\`, which is inherently\nvulnerable to XSS attacks. Please remove it from \`allowedTags\`.\nOr, to disable this warning, add the \`allowVulnerableTags\` option\nand ensure you are accounting for this risk.\n\n`);
    }
  });

  let depth = 0;
  let stack: Frame[] = [];
  let skipMap: Record<number, boolean> = {};
  let transformMap: Record<number, string> = {};
  let skipText = false;
  let skipTextDepth = 0;
  let addedText = false;

  function initializeState(): void {
    result = '';
    depth = 0;
    stack = [];
    skipMap = {};
    transformMap = {};
    skipText = false;
    skipTextDepth = 0;
  }

  initializeState();

  function escapeHtml(s: string | number | undefined, quote?: boolean): string {
    let str = typeof s !== 'string' ? '' + s : s;
    if (opts.parser?.decodeEntities) {
      // Fast path: most text/attribute values contain nothing to escape, so a
      // single scan lets us return the original string with zero allocation.
      if (quote ? !ESCAPE_SCAN_Q.test(str) : !ESCAPE_SCAN.test(str)) return str;
      // Entities were decoded at parse time, so every `&` is literal — escape
      // all of them. Chained native-string `.replace()` passes (callback-free)
      // beat a single-pass `/[&<>]/g` + function replacer in the full pipeline:
      // A/B showed the latter flat-to-slightly-worse (its per-match callback cost
      // on dense decoded-entity text outweighs the fewer-scans win on sparse text).
      str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return quote ? str.replace(/"/g, '&quot;') : str;
    }
    // decodeEntities off: preserve already-encoded entities (`&amp;` etc.).
    str = str.replace(/&(?![a-zA-Z0-9#]{1,20};)/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return quote ? str.replace(/"/g, '&quot;') : str;
  }

  function naughtyHref(name: string, href: string): boolean {
    const allowedSchemes = has(opts.allowedSchemesByTag, name)
      ? opts.allowedSchemesByTag[name]
      : (opts.allowedSchemes || []);
    return naughtyHrefImpl(href, {
      allowedSchemes,
      allowProtocolRelative: opts.allowProtocolRelative
    });
  }

  const parser = new Parser({
    onopentag(name, attribs) {
      if (opts.onOpenTag) opts.onOpenTag(name, attribs);

      if (opts.enforceHtmlBoundary && name === 'html') {
        initializeState();
      }

      if (skipText) {
        skipTextDepth++;
        return;
      }

      const frame = makeFrame(name, attribs);
      stack.push(frame);

      let skip = false;
      // (frame.text is always '' here — text only arrives via later ontext calls.)
      let transformedTag: TransformResult | undefined;
      if (hasTransformTags && has(transformTagsMap, name)) {
        transformedTag = transformTagsMap[name](name, attribs);
        frame.attribs = attribs = transformedTag.attribs;
        if (transformedTag.text !== undefined) {
          frame.innerText = transformedTag.text;
        }
        if (name !== transformedTag.tagName) {
          frame.name = name = transformedTag.tagName;
          transformMap[depth] = transformedTag.tagName;
        }
      }
      if (transformTagsAll) {
        transformedTag = transformTagsAll(name, attribs);
        frame.attribs = attribs = transformedTag.attribs;
        if (name !== transformedTag.tagName) {
          frame.name = name = transformedTag.tagName;
          transformMap[depth] = transformedTag.tagName;
        }
      }

      if (!tagAllowed(name) ||
        (modeRecursiveEscape && !isEmptyObject(skipMap)) ||
        (opts.nestingLimit != null && depth >= opts.nestingLimit)) {
        skip = true;
        skipMap[depth] = true;
        if (modeDiscardOrCompletely) {
          if (nonTextTagsArray.indexOf(name) !== -1) {
            skipText = true;
            skipTextDepth = 1;
          }
        }
      }
      depth++;
      if (skip) {
        if (modeDiscardOrCompletely) {
          if (frame.innerText) {
            const escaped = escapeHtml(frame.innerText);
            if (opts.textFilter) result += opts.textFilter(escaped, name);
            else result += escaped;
            addedText = true;
          }
          return;
        }
        tempResult = result;
        result = '';
      }
      result += '<' + name;

      if (name === 'script') {
        if (opts.allowedScriptHostnames || opts.allowedScriptDomains) {
          frame.innerText = '';
        }
      }

      const isBeingEscaped = skip && modeEscapeOrRecursive;
      const shouldPreserveEscapedAttributes = isBeingEscaped && opts.preserveEscapedAttributes;
      // Resolve `name`'s membership in the attribute allow-map ONCE — it gates the
      // branch below AND selects this tag's allowed-attr list (was two has() calls).
      const tagInAttrMap = allowedAttributesMap !== undefined && has(allowedAttributesMap, name);

      if (shouldPreserveEscapedAttributes) {
        each(attribs, (value, a) => {
          result += ' ' + a + '="' + escapeHtml(value || '', true) + '"';
        });
      } else if (!allowedAttributesMap || tagInAttrMap || allowedAttributesMap['*']) {
        // Skip all of this when the tag has no attributes (the common case for
        // <p>/<li>/<strong>/… — avoids 4 map lookups per attribute-less tag).
        const attrKeys = Object.keys(attribs);
        if (attrKeys.length) {
        // These lookups are constant across all of this tag's attributes, so
        // resolve them once instead of re-doing has()/property access per attr.
        const tagAttrList = tagInAttrMap
          ? (allowedAttributesMap![name] as AllowedAttribute[]) : undefined;
        const starAttrList = allowedAttributesMap
          ? (allowedAttributesMap['*'] as AllowedAttribute[] | undefined) : undefined;
        const tagGlob = (allowedAttributesGlobMap && has(allowedAttributesGlobMap, name))
          ? allowedAttributesGlobMap[name] : undefined;
        const starGlob = allowedAttributesGlobMap ? allowedAttributesGlobMap['*'] : undefined;
        for (const a of attrKeys) {
          let value = attribs[a];
          if (!(parserCleanAttrNames ? isAttrNameParserClean(a) : VALID_HTML_ATTRIBUTE_NAME.test(a))) {
            delete frame.attribs[a];
            continue;
          }
          if (value === '' && !emptyAttrSet.has(a) &&
            (nonBooleanAttrStar || nonBooleanAttrSet.has(a))) {
            delete frame.attribs[a];
            continue;
          }
          let passedAllowedAttributesMapCheck = false;
          if (!allowedAttributesMap ||
            (tagAttrList && tagAttrList.indexOf(a) !== -1) ||
            (starAttrList && starAttrList.indexOf(a) !== -1) ||
            (tagGlob && tagGlob.test(a)) ||
            (starGlob && starGlob.test(a))) {
            passedAllowedAttributesMapCheck = true;
          } else if (allowedAttributesMap && allowedAttributesMap[name]) {
            for (const o of allowedAttributesMap[name]) {
              if (isPlainObject(o)) {
                const obj = o as unknown as AllowedAttributeObject;
                if (obj.name && obj.name === a) {
                  passedAllowedAttributesMapCheck = true;
                  let newValue = '';
                  if (obj.multiple === true) {
                    const parts = value.split(' ');
                    for (const s of parts) {
                      if (obj.values.indexOf(s) !== -1) {
                        newValue = newValue === '' ? s : newValue + ' ' + s;
                      }
                    }
                  } else if (obj.values.indexOf(value) >= 0) {
                    newValue = value;
                  }
                  value = newValue;
                }
              }
            }
          }
          if (passedAllowedAttributesMapCheck) {
            if (schemeAttrSet.has(a)) {
              if (naughtyHref(name, value)) {
                delete frame.attribs[a];
                continue;
              }
            }

            if (name === 'script' && a === 'src') {
              let allowed: unknown = true;
              try {
                const parsed = parseUrl(value);
                if (opts.allowedScriptHostnames || opts.allowedScriptDomains) {
                  const allowedHostname = (opts.allowedScriptHostnames || [])
                    .find((hostname) => hostname === parsed.url.hostname);
                  const allowedDomain = (opts.allowedScriptDomains || [])
                    .find((domain) => parsed.url.hostname === domain || parsed.url.hostname.endsWith(`.${domain}`));
                  allowed = allowedHostname || allowedDomain;
                }
              } catch {
                allowed = false;
              }
              if (!allowed) {
                delete frame.attribs[a];
                continue;
              }
            }

            if (name === 'iframe' && a === 'src') {
              let allowed: unknown = true;
              try {
                const parsed = parseUrl(value);
                if (parsed.isRelativeUrl) {
                  allowed = has(opts, 'allowIframeRelativeUrls')
                    ? opts.allowIframeRelativeUrls
                    : (!opts.allowedIframeHostnames && !opts.allowedIframeDomains);
                } else if (opts.allowedIframeHostnames || opts.allowedIframeDomains) {
                  const allowedHostname = (opts.allowedIframeHostnames || [])
                    .find((hostname) => hostname === parsed.url.hostname);
                  const allowedDomain = (opts.allowedIframeDomains || [])
                    .find((domain) => parsed.url.hostname === domain || parsed.url.hostname.endsWith(`.${domain}`));
                  allowed = allowedHostname || allowedDomain;
                }
              } catch {
                allowed = false;
              }
              if (!allowed) {
                delete frame.attribs[a];
                continue;
              }
            }

            if (a === 'srcset' || a === 'imagesrcset') {
              try {
                let parsed = parseSrcset(value);
                parsed.forEach((v) => {
                  if (naughtyHref(a, v.url)) v.evil = true;
                });
                parsed = filter(parsed, (v) => !v.evil);
                if (!parsed.length) {
                  delete frame.attribs[a];
                  continue;
                } else {
                  value = stringifySrcset(filter(parsed, (v) => !v.evil));
                  frame.attribs[a] = value;
                }
              } catch {
                delete frame.attribs[a];
                continue;
              }
            }

            if (a === 'class') {
              const allowedSpecificClasses = allowedClassesMap[name];
              const allowedWildcardClasses = allowedClassesMap['*'];
              const allowedSpecificClassesGlob = allowedClassesGlobMap[name];
              const allowedSpecificClassesRegex = allowedClassesRegexMap[name];
              const allowedWildcardClassesRegex = allowedClassesRegexMap['*'];
              const allowedWildcardClassesGlob = allowedClassesGlobMap['*'];
              const allowedClassesGlobs: RegExp[] = [
                allowedSpecificClassesGlob,
                allowedWildcardClassesGlob
              ]
                .concat(allowedSpecificClassesRegex, allowedWildcardClassesRegex)
                .filter((t): t is RegExp => !!t);
              if (allowedSpecificClasses && allowedWildcardClasses) {
                value = filterClasses(
                  value,
                  deepmerge(allowedSpecificClasses as string[], allowedWildcardClasses as string[]) as string[],
                  allowedClassesGlobs
                );
              } else {
                value = filterClasses(
                  value,
                  (allowedSpecificClasses || allowedWildcardClasses) as string[] | false | undefined,
                  allowedClassesGlobs
                );
              }
              if (!value.length) {
                delete frame.attribs[a];
                continue;
              }
            }

            if (a === 'style') {
              if (opts.parseStyleAttributes) {
                try {
                  const ast = parseStyleAst(name, value);
                  const filteredAst = filterCss(ast, opts.allowedStyles);
                  value = stringifyStyleAttributes(filteredAst);
                  if (value.length === 0) {
                    delete frame.attribs[a];
                    continue;
                  }
                } catch {
                  delete frame.attribs[a];
                  continue;
                }
              } else if (opts.allowedStyles) {
                throw new Error('allowedStyles option cannot be used together with parseStyleAttributes: false.');
              }
            }

            // One concatenation per attribute (fewer intermediate rope nodes).
            if (value && value.length) {
              result += ' ' + a + '="' + escapeHtml(value, true) + '"';
            } else if (emptyAttrSet.has(a)) {
              result += ' ' + a + '=""';
            } else {
              result += ' ' + a;
            }
          } else {
            delete frame.attribs[a];
          }
        }
        }
      }
      if (selfClosingSet.has(name)) {
        result += ' />';
      } else {
        result += '>';
        if (frame.innerText && !opts.textFilter) {
          result += escapeHtml(frame.innerText);
          addedText = true;
        }
      }
      if (skip) {
        result = tempResult + escapeHtml(result);
        tempResult = '';
      }
      frame.openingTagLength = result.length - frame.tagPosition;
    },
    ontext(text, clean) {
      if (skipText) return;
      const lastFrame = stack[stack.length - 1];
      let tag: string | undefined;
      if (lastFrame) {
        tag = lastFrame.tag;
        if (lastFrame.innerText !== undefined) {
          text = lastFrame.innerText;
          clean = false; // innerText overrides the source text → re-check on escape
        }
      }
      if (modeCompletelyDiscard && !tagAllowed(tag)) {
        text = '';
      } else if (modeDiscardOrCompletely && (tag === 'script' || tag === 'style')) {
        result += text;
      } else if (modeDiscardOrCompletely && (tag === 'textarea' || tag === 'xmp')) {
        result += text;
      } else if (!addedText) {
        // `clean` (set by emitText) means the text has no &/</> → escapeHtml is a no-op.
        const escaped = clean ? text : escapeHtml(text, false);
        if (opts.textFilter) result += opts.textFilter(escaped, tag);
        else result += escaped;
      }
      // lastFrame is already stack[stack.length - 1] (the stack is unchanged here).
      if (lastFrame) {
        lastFrame.text += text;
      }
    },
    onclosetag(name, isImplied) {
      if (opts.onCloseTag) opts.onCloseTag(name, isImplied);

      if (skipText) {
        skipTextDepth--;
        if (!skipTextDepth) {
          skipText = false;
        } else {
          return;
        }
      }

      const frame = stack.pop();
      if (!frame) return;
      if (frame.tag !== name) {
        stack.push(frame);
        return;
      }

      skipText = opts.enforceHtmlBoundary ? name === 'html' : false;
      depth--;
      const skip = skipMap[depth];
      if (skip) {
        delete skipMap[depth];
        if (modeDiscardOrCompletely) {
          updateParentNodeText(stack, frame);
          return;
        }
        tempResult = result;
        result = '';
      }

      if (transformMap[depth]) {
        name = transformMap[depth];
        delete transformMap[depth];
      }

      if (opts.exclusiveFilter) {
        const filterResult = opts.exclusiveFilter(frame as unknown as IFrame);
        if (filterResult === 'excludeTag') {
          if (skip) {
            result = tempResult;
            tempResult = '';
          }
          result = result.substring(0, frame.tagPosition) +
            result.substring(frame.tagPosition + frame.openingTagLength);
          return;
        } else if (filterResult) {
          result = result.substring(0, frame.tagPosition);
          return;
        }
      }

      updateParentNodeMediaChildren(stack, frame);
      updateParentNodeText(stack, frame);

      if (
        selfClosingSet.has(name) ||
        (isImplied && !tagAllowed(name) && modeEscapeOrRecursive)
      ) {
        if (skip) {
          result = tempResult;
          tempResult = '';
        }
        return;
      }

      result += '</' + name + '>';
      if (skip) {
        result = tempResult + escapeHtml(result);
        tempResult = '';
      }
      addedText = false;
    }
  }, opts.parser);

  parser.write(inputHtml);
  parser.end();

  if (modeEscapeOrRecursive) {
    const lastParsedIndex = parser.endIndex;
    if (lastParsedIndex != null && lastParsedIndex >= 0 && lastParsedIndex < inputHtml.length) {
      const unparsed = inputHtml.substring(lastParsedIndex);
      result += escapeHtml(unparsed);
    } else if ((lastParsedIndex == null || lastParsedIndex < 0) && inputHtml.length > 0 && result === '') {
      result = escapeHtml(inputHtml);
    }
  }

  return result;
  }
}

const sanitizerCache = new WeakMap<object, Sanitizer>();
let defaultSanitizer: Sanitizer | undefined;

/**
 * Functional API — a thin, drop-in-compatible wrapper over `Sanitizer`. The
 * compiled options are cached per options object, so repeated calls that reuse
 * the same configuration skip recompilation.
 */
const sanitizeHtmlFn = function sanitizeHtml(
  html: string | number | null | undefined,
  options?: IOptions,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _recursing?: boolean
): string {
  let sanitizer: Sanitizer;
  if (options == null) {
    sanitizer = (defaultSanitizer ??= new Sanitizer());
  } else {
    let cached = sanitizerCache.get(options);
    if (cached === undefined) {
      cached = new Sanitizer(options);
      sanitizerCache.set(options, cached);
    }
    sanitizer = cached;
  }
  return sanitizer.sanitize(html);
} as SanitizeHtml;

// =============================================================================
// Defaults & static helpers
// =============================================================================

sanitizeHtmlFn.defaults = {
  allowedTags: [
    'address', 'article', 'aside', 'footer', 'header',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hgroup',
    'main', 'nav', 'section',
    'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
    'hr', 'li', 'menu', 'ol', 'p', 'pre', 'ul',
    'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn',
    'em', 'i', 'kbd', 'mark', 'q',
    'rb', 'rp', 'rt', 'rtc', 'ruby',
    's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
    'caption', 'col', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'tr'
  ],
  nonBooleanAttributes: [
    'abbr', 'accept', 'accept-charset', 'accesskey', 'action',
    'allow', 'alt', 'as', 'autocapitalize', 'autocomplete',
    'blocking', 'charset', 'cite', 'class', 'color', 'cols',
    'colspan', 'content', 'contenteditable', 'coords', 'crossorigin',
    'data', 'datetime', 'decoding', 'dir', 'dirname', 'download',
    'draggable', 'enctype', 'enterkeyhint', 'fetchpriority', 'for',
    'form', 'formaction', 'formenctype', 'formmethod', 'formtarget',
    'headers', 'height', 'hidden', 'high', 'href', 'hreflang',
    'http-equiv', 'id', 'imagesizes', 'imagesrcset', 'inputmode',
    'integrity', 'is', 'itemid', 'itemprop', 'itemref', 'itemtype',
    'kind', 'label', 'lang', 'list', 'loading', 'low', 'max',
    'maxlength', 'media', 'method', 'min', 'minlength', 'name',
    'nonce', 'optimum', 'pattern', 'ping', 'placeholder', 'popover',
    'popovertarget', 'popovertargetaction', 'poster', 'preload',
    'referrerpolicy', 'rel', 'rows', 'rowspan', 'sandbox', 'scope',
    'shape', 'size', 'sizes', 'slot', 'span', 'spellcheck', 'src',
    'srcdoc', 'srclang', 'srcset', 'start', 'step', 'style',
    'tabindex', 'target', 'title', 'translate', 'type', 'usemap',
    'value', 'width', 'wrap',
    'onauxclick', 'onafterprint', 'onbeforematch', 'onbeforeprint',
    'onbeforeunload', 'onbeforetoggle', 'onblur', 'oncancel',
    'oncanplay', 'oncanplaythrough', 'onchange', 'onclick', 'onclose',
    'oncontextlost', 'oncontextmenu', 'oncontextrestored', 'oncopy',
    'oncuechange', 'oncut', 'ondblclick', 'ondrag', 'ondragend',
    'ondragenter', 'ondragleave', 'ondragover', 'ondragstart',
    'ondrop', 'ondurationchange', 'onemptied', 'onended',
    'onerror', 'onfocus', 'onformdata', 'onhashchange', 'oninput',
    'oninvalid', 'onkeydown', 'onkeypress', 'onkeyup',
    'onlanguagechange', 'onload', 'onloadeddata', 'onloadedmetadata',
    'onloadstart', 'onmessage', 'onmessageerror', 'onmousedown',
    'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout',
    'onmouseover', 'onmouseup', 'onoffline', 'ononline', 'onpagehide',
    'onpageshow', 'onpaste', 'onpause', 'onplay', 'onplaying',
    'onpopstate', 'onprogress', 'onratechange', 'onreset', 'onresize',
    'onrejectionhandled', 'onscroll', 'onscrollend',
    'onsecuritypolicyviolation', 'onseeked', 'onseeking', 'onselect',
    'onslotchange', 'onstalled', 'onstorage', 'onsubmit', 'onsuspend',
    'ontimeupdate', 'ontoggle', 'onunhandledrejection', 'onunload',
    'onvolumechange', 'onwaiting', 'onwheel'
  ],
  disallowedTagsMode: 'discard',
  allowedAttributes: {
    a: [ 'href', 'name', 'target' ],
    img: [ 'src', 'srcset', 'alt', 'title', 'width', 'height', 'loading' ]
  },
  allowedEmptyAttributes: [ 'alt' ],
  selfClosing: [ 'img', 'br', 'hr', 'area', 'base', 'basefont', 'input', 'link', 'meta' ],
  allowedSchemes: [ 'http', 'https', 'ftp', 'mailto', 'tel' ],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: [
    'href', 'src', 'cite',
    'action', 'formaction', 'data', 'xlink:href',
    'poster', 'background', 'ping',
    'longdesc', 'usemap', 'codebase', 'classid', 'archive',
    'profile', 'manifest', 'itemid',
    'dynsrc', 'lowsrc'
  ],
  allowProtocolRelative: true,
  enforceHtmlBoundary: false,
  parseStyleAttributes: true,
  preserveEscapedAttributes: false
};

sanitizeHtmlFn.simpleTransform = function (newTagName: string, newAttribs?: Attributes, merge?: boolean): Transformer {
  const doMerge = merge === undefined ? true : merge;
  const attribsToAdd = newAttribs || {};
  return function (_tagName: string, attribs: Attributes): TransformResult {
    let outAttribs: Attributes;
    if (doMerge) {
      outAttribs = attribs;
      for (const k of Object.keys(attribsToAdd)) outAttribs[k] = attribsToAdd[k];
    } else {
      outAttribs = attribsToAdd;
    }
    return { tagName: newTagName, attribs: outAttribs };
  };
};

const sanitizeHtml = sanitizeHtmlFn;

export default sanitizeHtml;

/**
 * @internal Test-only. The published build entry (`./entry.ts`) re-exports ONLY
 * the default, so this named export never reaches the bundle — that keeps the
 * CommonJS output a bare `module.exports = sanitize` (a true drop-in for
 * `sanitize-html`, whose `.defaults` / `.simpleTransform` are likewise hung off
 * the function above). The suite imports it to prove `isAttrNameParserClean` is
 * byte-for-byte equivalent to `VALID_HTML_ATTRIBUTE_NAME`.
 */
export const __internal = { isAttrNameParserClean, VALID_HTML_ATTRIBUTE_NAME };
