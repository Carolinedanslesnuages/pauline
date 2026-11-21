/**
 * The shared guidelines block inside AGENTS.md, between two markers:
 *
 *   <!-- pauline:debut empreinte=1a2b3c4d5e6f -->
 *   … the base guidelines …
 *   <!-- pauline:fin -->
 *
 * The fingerprint is the one of the content Pauline wrote: when the block no longer matches it,
 * someone edited it by hand, and Pauline refuses to overwrite it without --forcer. The rest of the
 * file (the project's own guidelines) is never touched.
 */
import { createHash } from 'node:crypto';

const START_MARKER = /<!-- pauline:debut empreinte=([0-9a-f]{12}) -->\n/;
const END_MARKER = '<!-- pauline:fin -->';

const normalize = (text) => text.replace(/\r\n/g, '\n');

export const fingerprint = (text) => createHash('sha256').update(normalize(text).trim()).digest('hex').slice(0, 12);

export function block(base) {
  const content = normalize(base).trim();
  return `<!-- pauline:debut empreinte=${fingerprint(content)} -->\n${content}\n${END_MARKER}`;
}

/** Splits AGENTS.md into { before, content, after, recorded }, or null when there is no block. */
export function extract(text) {
  const source = normalize(text);
  const start = START_MARKER.exec(source);
  if (!start) return null;
  const contentStart = start.index + start[0].length;
  const endIndex = source.indexOf(END_MARKER, contentStart);
  if (endIndex < 0) return null;
  return {
    before: source.slice(0, start.index),
    content: source.slice(contentStart, endIndex),
    after: source.slice(endIndex + END_MARKER.length),
    recorded: start[1],
  };
}

/**
 * State of a repository for this base:
 *   missing      no AGENTS.md
 *   no-block     AGENTS.md without a Pauline block
 *   up-to-date   block identical to the base
 *   outdated     block written by Pauline, from an older base
 *   edited       block changed by hand since Pauline wrote it
 */
export function state(agentsText, base) {
  if (agentsText == null) return 'missing';
  const found = extract(agentsText);
  if (!found) return 'no-block';
  if (fingerprint(found.content) !== found.recorded) return 'edited';
  return found.recorded === fingerprint(base) ? 'up-to-date' : 'outdated';
}

/** New AGENTS.md: the block up to date, everything else untouched. */
export function merge(agentsText, base, projectName) {
  if (agentsText == null) {
    return `# ${projectName}\n\n${block(base)}\n\n## Consignes de ce projet\n\nLes consignes propres à ce projet viennent ici.\n`;
  }
  const source = normalize(agentsText);
  const found = extract(source);
  if (found) return `${found.before}${block(base)}${found.after}`;
  // No block yet: right after the main heading when the file starts with one, otherwise at the top.
  const heading = /^# .*\n/m.exec(source);
  if (heading && heading.index === source.search(/\S/)) {
    const headingEnd = heading.index + heading[0].length;
    return `${source.slice(0, headingEnd)}\n${block(base)}\n${source.slice(headingEnd).replace(/^\n*/, '\n')}`;
  }
  return `${block(base)}\n\n${source}`;
}

/** CLAUDE.md that imports AGENTS.md, so Claude Code reads the same guidelines. */
export function claudeFile(content) {
  if (content == null || !content.trim()) return '@AGENTS.md\n';
  if (/^@AGENTS\.md\s*$/m.test(content)) return content;
  return `@AGENTS.md\n\n${content}`;
}
