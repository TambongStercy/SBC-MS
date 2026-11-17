import { describe, expect, it } from 'vitest';
import type { GuideNode } from '../../api/types';
import { addChild, moveAt, removeAt, updateAt, validateTree } from './guideTree';
import { slugify } from './text';

const n = (id: string, children: GuideNode[] = [], extra: Partial<GuideNode> = {}): GuideNode => ({ id, label: id, kind: 'question', children, ...extra });

describe('guided paths tree', () => {
  const tree = [n('a', [n('a1'), n('a2')]), n('b')];

  it('edits immutably by path', () => {
    expect(updateAt(tree, [0, 1], { label: 'X' })[0].children[1].label).toBe('X');
    expect(tree[0].children[1].label).toBe('a2');
    expect(removeAt(tree, [0, 0])[0].children.map(c => c.id)).toEqual(['a2']);
    expect(moveAt(tree, [1], -1).map(c => c.id)).toEqual(['b', 'a']);
    expect(moveAt(tree, [0], -1)).toEqual(tree);
    expect(addChild(tree, [1], n('b1'))[1].children.map(c => c.id)).toEqual(['b1']);
    expect(addChild(tree, [], n('c')).map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('validates leaves', () => {
    expect(validateTree(tree)).toBeNull();
    expect(validateTree([n('x', [], { kind: 'article' })])).toMatch(/adresse/);
    expect(validateTree([n('x', [], { kind: 'route' })])).toMatch(/parcours/);
    expect(validateTree([n('x', [n('y')], { kind: 'route', route: 'ticket' })])).toMatch(/sous-étapes/);
    expect(validateTree([n('x', [], { label: ' ' })])).toMatch(/intitulé/);
  });

  it('slugifies French titles', () => {
    expect(slugify('Mon compte n’est pas activé !')).toBe('mon-compte-n-est-pas-active');
  });
});
