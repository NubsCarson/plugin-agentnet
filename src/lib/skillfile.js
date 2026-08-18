/**
 * SKILL.md file handling for equipped AgentNet items, matching the
 * @elizaos/skills on-disk format so plugin-agent-skills' loader picks the
 * files up unchanged (packages/skills/src/loader.ts): YAML frontmatter with
 * `name` equal to the parent directory name (lowercase a-z0-9 hyphens, max
 * 64 chars, validateName at loader.ts:41) and `description` (max 1024
 * chars), then the markdown body. Extra frontmatter keys are legal
 * (SkillFrontmatter index signature, packages/skills/src/types.ts:22); we
 * stamp `agentnet-mint` as the provenance marker the equipped-skills
 * provider scans for. Default install dir mirrors the loader's user store
 * `<stateDir>/skills` (loader.ts:282-304) with stateDir precedence from
 * core utils/state-dir.ts:49 (ELIZA_STATE_DIR > $XDG_STATE_HOME/eliza >
 * ~/.local/state/eliza).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const MARKER_KEY = "agentnet-mint";

/** `<stateDir>/skills` with core's documented state-dir precedence. */
export function defaultSkillsDir(env = process.env) {
  const explicit = (env.ELIZA_STATE_DIR ?? "").trim();
  if (explicit) return join(explicit.startsWith("~") ? explicit.replace(/^~(?=$|[\\/])/, homedir()) : explicit, "skills");
  const namespace = (env.ELIZA_NAMESPACE ?? "").trim() || "eliza";
  const xdg = (env.XDG_STATE_HOME ?? "").trim();
  if (xdg) return isAbsolute(xdg) ? join(xdg, namespace, "skills") : join(homedir(), xdg, namespace, "skills");
  return join(homedir(), ".local", "state", namespace, "skills");
}

/** Loader-legal directory/frontmatter name from an item name. */
export function slugify(name) {
  const slug = String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!slug) throw new Error(`cannot derive a skill slug from name "${name}"`);
  return slug;
}

/** Render SKILL.md: frontmatter (name matches the parent dir; description as
 *  a JSON-quoted YAML scalar so embedded quotes/colons stay valid) + body. */
export function renderSkillMd({ slug, description, mint, sig, body }) {
  const desc = String(description ?? "").replace(/\s+/g, " ").trim().slice(0, 1024);
  return [
    "---",
    `name: ${JSON.stringify(slug)}`,
    `description: ${JSON.stringify(desc)}`,
    `${MARKER_KEY}: ${JSON.stringify(mint)}`,
    `agentnet-sig: ${JSON.stringify(sig)}`,
    "---",
    "",
    String(body ?? "").trim(),
    "",
  ].join("\n");
}

/** Write <skillsDir>/<slug>/SKILL.md. Idempotent: identical content is left
 *  untouched and reported as already equipped. Returns { file, already }. */
export function writeSkillMd(skillsDir, slug, rendered) {
  const dir = join(skillsDir, slug);
  const file = join(dir, "SKILL.md");
  if (existsSync(file) && readFileSync(file, "utf8") === rendered) {
    return { file, already: true };
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, rendered);
  return { file, already: false };
}

/** Scan each <skillsDir>/<slug>/SKILL.md for our frontmatter marker. Returns
 *  [{ slug, mint }] for AgentNet-equipped skills only; foreign skills (no
 *  marker) and non-skill entries are skipped. Missing dir means none. */
export function equippedSkills(skillsDir) {
  let entries;
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const equipped = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(skillsDir, entry.name, "SKILL.md");
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    const marker = fm[1].match(new RegExp(`^${MARKER_KEY}:[ \\t]*(.+)$`, "m"));
    if (!marker) continue;
    let mint = marker[1].trim();
    if (mint.startsWith('"')) {
      // JSON-quoted scalar (what renderSkillMd writes). Unparseable = skip.
      try {
        mint = JSON.parse(mint);
      } catch {
        continue;
      }
    }
    if (typeof mint !== "string" || mint === "") continue;
    equipped.push({ slug: entry.name, mint });
  }
  return equipped.sort((a, b) => a.slug.localeCompare(b.slug));
}
