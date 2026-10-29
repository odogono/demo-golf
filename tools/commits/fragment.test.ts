import { expect, test } from 'bun:test';

import { fragmentMatches, parseFragment, type Fragment } from './fragment';
import { parseCommitSubject, type Subject } from './message';

const fragment = (text: string): Fragment => {
  const result = parseFragment(text);
  if ('errors' in result) {
    throw new Error(result.errors.join('\n'));
  }
  return result.fragment;
};

const subject = (text: string): Subject => {
  const result = parseCommitSubject(text);
  if ('errors' in result) {
    throw new Error(result.errors.join('\n'));
  }
  return result.subject;
};

test('reads a fragment', () => {
  expect(
    fragment(
      '---\ntype: feat\nscope: game\nsection: added\n---\nAdd x.\n\nMore.\n'
    )
  ).toEqual({
    breaking: false,
    entry: 'Add x.\n\nMore.',
    scope: 'game',
    section: 'added',
    type: 'feat'
  });
  expect(
    fragment('---\ntype: fix\nsection: fixed\nbreaking: true\n---\nFix x.')
  ).toEqual({
    breaking: true,
    entry: 'Fix x.',
    scope: undefined,
    section: 'fixed',
    type: 'fix'
  });
});

test('lets a known entry come with any type', () => {
  expect(
    fragment('---\ntype: docs\nscope: docs\nsection: known\n---\nX.')
  ).toMatchObject({ section: 'known', type: 'docs' });
  expect(
    parseFragment('---\ntype: wip\nsection: known\n---\nX.')
  ).toHaveProperty('errors');
});

test('rejects fragments without frontmatter, a type, a section, a valid scope or text', () => {
  expect(parseFragment('Add x.')).toEqual({
    errors: ['it must start with a "---" frontmatter block']
  });
  expect(parseFragment('---\nsection: added\n---\nAdd x.')).toEqual({
    errors: ['"type" is missing']
  });
  expect(parseFragment('---\ntype: feat\n---\nAdd x.')).toEqual({
    errors: ['"section" is missing']
  });
  expect(
    parseFragment('---\ntype: docs\nsection: added\n---\nAdd x.')
  ).toHaveProperty('errors');
  expect(
    parseFragment('---\ntype: feat\nsection: added\nscope: core\n---\nAdd x.')
  ).toEqual({
    errors: [
      'unknown scope "core"; use one of game, ui, tools, docs, repo'
    ]
  });
  expect(
    parseFragment('---\ntype: feat\nsection: added\nsummary: x\n---\nAdd x.')
  ).toEqual({
    errors: ['unknown key "summary"']
  });
  expect(parseFragment('---\ntype: feat\nsection: added\n---\n\n')).toEqual({
    errors: ['the entry text after the frontmatter is empty']
  });
});

test('rejects a section the type does not belong under', () => {
  expect(parseFragment('---\ntype: fix\nsection: added\n---\nX.')).toEqual({
    errors: ['a fix entry goes under fixed, or known, not added']
  });
  expect(parseFragment('---\ntype: perf\nsection: fixed\n---\nX.')).toEqual({
    errors: ['a perf entry goes under changed, or known, not fixed']
  });
  expect(parseFragment('---\ntype: feat\nsection: misc\n---\nX.')).toEqual({
    errors: [
      'unknown section "misc"; use one of added, changed, removed, fixed, known'
    ]
  });
  expect(fragment('---\ntype: feat\nsection: removed\n---\nX.').section).toBe(
    'removed'
  );
});

test('matches a fragment to the PR title by type, scope and breaking', () => {
  const feat = fragment(
    '---\ntype: feat\nscope: game\nsection: added\n---\nAdd x.'
  );
  expect(fragmentMatches(feat, subject('feat(game): Add x'), false)).toBe(true);
  expect(fragmentMatches(feat, subject('feat(ui): Add x'), false)).toBe(
    false
  );
  expect(fragmentMatches(feat, subject('feat: Add x'), false)).toBe(false);
  expect(fragmentMatches(feat, subject('fix(game): Fix x'), false)).toBe(false);
  expect(fragmentMatches(feat, subject('feat(game)!: Add x'), true)).toBe(false);

  const breaking = fragment(
    '---\ntype: feat\nscope: ui\nsection: changed\nbreaking: true\n---\nRename x.'
  );
  expect(
    fragmentMatches(breaking, subject('refactor(ui)!: Rename x'), true)
  ).toBe(true);
  expect(
    fragmentMatches(breaking, subject('refactor(tools)!: Rename x'), true)
  ).toBe(false);
});

test('never takes a known entry as the required fragment', () => {
  const known = fragment(
    '---\ntype: fix\nscope: tools\nsection: known\n---\nStill broken.'
  );
  expect(fragmentMatches(known, subject('fix(tools): Fix x'), false)).toBe(
    false
  );
});
