// Reads a changelog fragment: one file in changelog/unreleased/ per PR that
// needs an entry, as changelog/README.md describes.
//
//   ---
//   type: feat
//   scope: game
//   section: added
//   breaking: true
//   ---
//   **Putts break with the slope.** More about it.

import {
  CHANGELOG_TYPES,
  SCOPES,
  TYPES,
  type CommitType,
  type Scope,
  type Subject
} from './message';

// The Keep a Changelog sections, in the order a release prints them.
export const SECTIONS = [
  'added',
  'changed',
  'removed',
  'fixed',
  'known'
] as const;
export type Section = (typeof SECTIONS)[number];

// The sections each changelog type may file its entry under. A `known` entry,
// an outstanding problem, may come with any type.
const SECTIONS_BY_TYPE: Record<(typeof CHANGELOG_TYPES)[number], Section[]> = {
  feat: ['added', 'changed', 'removed'],
  fix: ['fixed'],
  perf: ['changed']
};

export type Fragment = {
  breaking: boolean;
  entry: string;
  scope?: Scope | undefined;
  section: Section;
  type: CommitType;
};

const FRONTMATTER = /^---\n(?<head>[\S\s]*?)\n---\n(?<body>[\S\s]*)$/;
const KEYS = new Set(['type', 'scope', 'section', 'breaking']);

const isChangelogType = (
  type: string
): type is (typeof CHANGELOG_TYPES)[number] =>
  (CHANGELOG_TYPES as readonly string[]).includes(type);

export const parseFragment = (
  text: string
): { errors: string[] } | { fragment: Fragment } => {
  const match = FRONTMATTER.exec(text.replaceAll('\r\n', '\n'));
  if (!match?.groups) {
    return { errors: ['it must start with a "---" frontmatter block'] };
  }
  const errors: string[] = [];
  const fields = new Map<string, string>();
  for (const line of match.groups.head!.split('\n')) {
    const field = /^(?<key>[a-z]+):\s*(?<value>.*?)\s*$/.exec(line);
    const key = field?.groups?.key;
    if (key === undefined) {
      errors.push(`"${line}" isn't "key: value"`);
    } else if (KEYS.has(key)) {
      fields.set(key, field!.groups!.value!);
    } else {
      errors.push(`unknown key "${key}"`);
    }
  }
  const type = fields.get('type');
  const scope = fields.get('scope');
  const section = fields.get('section');
  const breaking = fields.get('breaking');
  if (section === undefined) {
    errors.push('"section" is missing');
  } else if (!(SECTIONS as readonly string[]).includes(section)) {
    errors.push(
      `unknown section "${section}"; use one of ${SECTIONS.join(', ')}`
    );
  }
  if (type === undefined) {
    errors.push('"type" is missing');
  } else if (section === 'known') {
    if (!(TYPES as readonly string[]).includes(type)) {
      errors.push(`unknown type "${type}"; use one of ${TYPES.join(', ')}`);
    }
  } else if (!isChangelogType(type)) {
    errors.push(
      `type "${type}" isn't one of ${CHANGELOG_TYPES.join(', ')}; a breaking change of another type uses the closest of these with "breaking: true", and only a "known" entry may come with any type`
    );
  } else if (
    section !== undefined &&
    (SECTIONS as readonly string[]).includes(section) &&
    !SECTIONS_BY_TYPE[type].includes(section as Section)
  ) {
    errors.push(
      `a ${type} entry goes under ${SECTIONS_BY_TYPE[type].join(' or ')}, or known, not ${section}`
    );
  }
  if (scope !== undefined && !(SCOPES as readonly string[]).includes(scope)) {
    errors.push(`unknown scope "${scope}"; use one of ${SCOPES.join(', ')}`);
  }
  if (breaking !== undefined && breaking !== 'true' && breaking !== 'false') {
    errors.push(`"breaking" must be true or false, not "${breaking}"`);
  }
  const entry = match.groups.body!.trim();
  if (entry === '') {
    errors.push('the entry text after the frontmatter is empty');
  }
  if (errors.length > 0) {
    return { errors };
  }
  return {
    fragment: {
      breaking: breaking === 'true',
      entry,
      scope: scope as Scope | undefined,
      section: section as Section,
      type: type as CommitType
    }
  };
};

// Whether a fragment records the change a PR title describes: the same type
// and scope, and breaking when the change is. A `known` entry never does.
export const fragmentMatches = (
  fragment: Fragment,
  subject: Subject,
  breaking: boolean
): boolean =>
  fragment.section !== 'known' &&
  fragment.scope === subject.scope &&
  fragment.breaking === breaking &&
  (isChangelogType(subject.type) ? fragment.type === subject.type : breaking);
