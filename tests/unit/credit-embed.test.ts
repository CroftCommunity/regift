import { describe, it, expect } from 'vitest';
import { embeddedCredit } from '../../src/core/credit';
import type { Post } from '../../src/core/post';

const post = (over: Partial<Post>): Post => ({ source: 'reddit', title: null, author: null, where: null, permalink: null, items: [], ...over });

describe('embeddedCredit: what goes inside the file', () => {
  it('description carries the title and the credit line; author and source stand alone', () => {
    expect(embeddedCredit(post({ title: 'Dad jokes', author: 'someredditor', where: 'r/GuysBeingDudes', permalink: 'https://r/x' }))).toEqual({
      description: 'Dad jokes — via u/someredditor on r/GuysBeingDudes — https://r/x',
      author: 'u/someredditor',
      source: 'https://r/x',
    });
  });

  it('never writes the word null; empty strings where nothing is known', () => {
    expect(embeddedCredit(post({}))).toEqual({ description: 'via Reddit', author: '', source: '' });
  });
});
