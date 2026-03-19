import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type InstallKind = "brew" | "node" | "go" | "uv" | "download";

export type InstallSpec = {
  kind: InstallKind;
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  os?: string[];
};

export type SkillFrontmatter = {
  name: string;
  description: string;
  homepage?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
  };
  install?: InstallSpec[];
};

export type FrontmatterValidationResult = {
  valid: boolean;
  errors: string[];
  parsed?: SkillFrontmatter;
};

// ---------------------------------------------------------------------------
// 字段模式校验
// ---------------------------------------------------------------------------

const BREW_FORMULA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9@+._/-]*$/;
const GO_MODULE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~+\-/]*(?:@[A-Za-z0-9][A-Za-z0-9._~+\-/]*)?$/;
const UV_PACKAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=<>!~+,]*$/;

const NPM_SCOPED_PATTERN = /^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/;
const NPM_UNSCOPED_PATTERN = /^[a-z0-9-~][a-z0-9-._~]*$/;

function normalizeSafeBrewFormula(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const formula = raw.trim();
  if (!formula || formula.startsWith("-") || formula.includes("\\") || formula.includes(".."))
    return undefined;
  if (!BREW_FORMULA_PATTERN.test(formula)) return undefined;
  return formula;
}

function normalizeSafeNpmSpec(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const spec = raw.trim();
  if (!spec || spec.startsWith("-")) return undefined;

  const atIdx = spec.lastIndexOf("@");
  const name = atIdx > 0 ? spec.slice(0, atIdx) : spec;

  if (!NPM_SCOPED_PATTERN.test(name) && !NPM_UNSCOPED_PATTERN.test(name)) return undefined;

  if (atIdx > 0) {
    const ver = spec.slice(atIdx + 1);
    if (/[/\\]|:\/\/|^git\+|^file:|^github:|^bitbucket:/.test(ver)) return undefined;
  }

  return spec;
}

function normalizeSafeGoModule(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const mod = raw.trim();
  if (!mod || mod.startsWith("-") || mod.includes("\\") || mod.includes("://")) return undefined;
  if (!GO_MODULE_PATTERN.test(mod)) return undefined;
  return mod;
}

function normalizeSafeUvPackage(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const pkg = raw.trim();
  if (!pkg || pkg.startsWith("-") || pkg.includes("\\") || pkg.includes("://")) return undefined;
  if (!UV_PACKAGE_PATTERN.test(pkg)) return undefined;
  return pkg;
}

function normalizeSafeDownloadUrl(
  raw: unknown,
  allowedDomains?: string[],
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value || /\s/.test(value)) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return undefined;
    if (allowedDomains && allowedDomains.length > 0) {
      const hostname = parsed.hostname.toLowerCase();
      const allowed = allowedDomains.some(
        (d) => hostname === d || hostname.endsWith(`.${d}`),
      );
      if (!allowed) return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Frontmatter 解析与校验
// ---------------------------------------------------------------------------

function parseInstallSpec(raw: unknown, allowedDomains?: string[]): InstallSpec | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;

  const VALID_KINDS: InstallKind[] = ["brew", "node", "go", "uv", "download"];
  const kind = obj.kind as InstallKind;
  if (!VALID_KINDS.includes(kind)) return undefined;

  const spec: InstallSpec = { kind };

  if (kind === "brew") {
    const formula = normalizeSafeBrewFormula(obj.formula ?? obj.cask);
    if (!formula) return undefined;
    spec.formula = formula;
  } else if (kind === "node") {
    const pkg = normalizeSafeNpmSpec(obj.package);
    if (!pkg) return undefined;
    spec.package = pkg;
  } else if (kind === "go") {
    const mod = normalizeSafeGoModule(obj.module);
    if (!mod) return undefined;
    spec.module = mod;
  } else if (kind === "uv") {
    const pkg = normalizeSafeUvPackage(obj.package);
    if (!pkg) return undefined;
    spec.package = pkg;
  } else if (kind === "download") {
    const url = normalizeSafeDownloadUrl(obj.url, allowedDomains);
    if (!url) return undefined;
    spec.url = url;
  }

  if (Array.isArray(obj.os)) {
    spec.os = obj.os.filter((v) => typeof v === "string");
  }

  return spec;
}

export function validateFrontmatter(
  content: string,
  allowedDownloadDomains?: string[],
): FrontmatterValidationResult {
  const errors: string[] = [];

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return { valid: false, errors: ["SKILL.md is missing YAML frontmatter block (--- ... ---)"] };
  }

  let raw: Record<string, unknown>;
  try {
    raw = parseYaml(fmMatch[1]) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { valid: false, errors: ["YAML frontmatter must be an object"] };
    }
  } catch (err) {
    return { valid: false, errors: [`YAML parse error: ${String(err)}`] };
  }

  if (typeof raw.name !== "string" || !raw.name.trim()) {
    errors.push("Missing required field: name");
  }
  if (typeof raw.description !== "string" || !raw.description.trim()) {
    errors.push("Missing required field: description");
  }

  if (raw.homepage !== undefined) {
    try {
      const u = new URL(String(raw.homepage));
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        errors.push(`homepage must be an HTTP(S) URL, got: ${raw.homepage}`);
      }
    } catch {
      errors.push(`homepage is not a valid URL: ${raw.homepage}`);
    }
  }

  if (raw.os !== undefined && !Array.isArray(raw.os)) {
    errors.push("os must be an array of platform strings");
  }

  const installSpecs: InstallSpec[] = [];
  if (raw.install !== undefined) {
    const rawInstall = Array.isArray(raw.install) ? raw.install : [raw.install];
    for (let i = 0; i < rawInstall.length; i++) {
      const spec = parseInstallSpec(rawInstall[i], allowedDownloadDomains);
      if (!spec) {
        const kind = (rawInstall[i] as Record<string, unknown>)?.kind;
        errors.push(
          `install[${i}]: invalid spec (kind="${kind ?? "unknown"}") — check required fields and allowed formats`,
        );
      } else {
        installSpecs.push(spec);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const parsed: SkillFrontmatter = {
    name: (raw.name as string).trim(),
    description: (raw.description as string).trim(),
    homepage: raw.homepage !== undefined ? String(raw.homepage) : undefined,
    os: Array.isArray(raw.os) ? (raw.os as string[]) : undefined,
    install: installSpecs.length > 0 ? installSpecs : undefined,
  };

  if (typeof raw.requires === "object" && raw.requires !== null) {
    const req = raw.requires as Record<string, unknown>;
    parsed.requires = {
      bins: Array.isArray(req.bins) ? (req.bins as string[]) : undefined,
      anyBins: Array.isArray(req.anyBins) ? (req.anyBins as string[]) : undefined,
      env: Array.isArray(req.env) ? (req.env as string[]) : undefined,
    };
  }

  return { valid: true, errors: [], parsed };
}
