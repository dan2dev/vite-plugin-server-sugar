import { describe, expect, it } from 'vitest';
import { createEndpointPaths, endpointUrl } from '../../src/endpoint-paths';

describe('endpoint paths', () => {
  it('keeps the default server and ws prefixes', () => {
    expect(createEndpointPaths()).toEqual({
      apiPrefix: '/__server-build/',
      wsPrefix: '/__server-build-ws/',
    });
  });

  it('normalizes a custom pathname base', () => {
    expect(createEndpointPaths('rpc/')).toEqual({
      apiPrefix: '/rpc/',
      wsPrefix: '/rpc-ws/',
    });
  });

  it('supports nested custom pathname bases', () => {
    expect(createEndpointPaths('/api/rpc')).toEqual({
      apiPrefix: '/api/rpc/',
      wsPrefix: '/api/rpc-ws/',
    });
  });

  it('encodes endpoint segments under the supplied prefix', () => {
    expect(endpointUrl('/rpc/', 'todos/get todos')).toBe('/rpc/todos/get%20todos');
  });

  it('rejects pathnames that are not routable path bases', () => {
    expect(() => createEndpointPaths('')).toThrow('pathnameBase must not be empty');
    expect(() => createEndpointPaths('/')).toThrow('at least one path segment');
    expect(() => createEndpointPaths('https://example.com/rpc')).toThrow('not a URL');
    expect(() => createEndpointPaths('/rpc?x=1')).toThrow('query string or hash');
  });
});
