import { describe, it, expect } from 'vitest';
import { jsonpRequest } from '../../src/adapters/web/jsonp';

describe('jsonpRequest', () => {
  it('adds the callback to the query without disturbing the rest', () => {
    const r = jsonpRequest('https://www.reddit.com/r/a/comments/1abc/t/.json?limit=0&raw_json=1', 7);
    expect(r.name).toBe('__regift_jsonp_7');
    expect(r.src).toBe('https://www.reddit.com/r/a/comments/1abc/t/.json?limit=0&raw_json=1&jsonp=__regift_jsonp_7');
  });
});
