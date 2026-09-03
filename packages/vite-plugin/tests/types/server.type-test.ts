/// <reference path="../../server.d.ts" />
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BodyServerFunction,
  ServerContext as ImportedServerContext,
  ServerFunction,
} from '../../server';

/**
 * Type tests for $server() type inference.
 *
 * Validates: Requirements 10.1, 10.2, 10.6
 */
describe('server type inference', () => {
  it('infers matching client wrapper parameter types from typed parameters', () => {
    // **Validates: Requirements 10.1**
    const wrapper = $server((x: number, y: string) => ({ x, y }));

    expectTypeOf(wrapper).parameter(0).toEqualTypeOf<number>();
    expectTypeOf(wrapper).parameter(1).toEqualTypeOf<string>();
    expectTypeOf(wrapper).parameters.toEqualTypeOf<[number, string]>();
  });

  it('infers Promise<Awaited<R>> return type on client', () => {
    // **Validates: Requirements 10.2**
    const syncWrapper = $server((x: number) => x * 2);
    expectTypeOf(syncWrapper).returns.toEqualTypeOf<Promise<number>>();

    const asyncWrapper = $server(async (name: string) => ({ name, id: 1 }));
    expectTypeOf(asyncWrapper).returns.toEqualTypeOf<Promise<{ name: string; id: number }>>();

    // Nested Promise should be flattened via Awaited
    const nestedPromise = $server(async () => Promise.resolve(42));
    expectTypeOf(nestedPromise).returns.toEqualTypeOf<Promise<number>>();
  });

  it('preserves optional and rest parameter tuples', () => {
    const optional = $server((id: string, includeDeleted?: boolean) => ({ id, includeDeleted }));
    expectTypeOf(optional).parameters.toEqualTypeOf<[
      id: string,
      includeDeleted?: boolean,
    ]>();

    const variadic = $server((prefix: string, ...values: number[]) =>
      values.map((value) => `${prefix}${value}`),
    );
    expectTypeOf(variadic).parameters.toEqualTypeOf<[
      prefix: string,
      ...values: number[],
    ]>();
    expectTypeOf(variadic).returns.toEqualTypeOf<Promise<string[]>>();
  });

  it('exposes reusable named types without losing the ambient macro API', () => {
    const fn = $server(async (id: string) => ({ id, found: true as const }));
    expectTypeOf(fn).toEqualTypeOf<
      ServerFunction<[id: string], { id: string; found: true }>
    >();

    expectTypeOf<ImportedServerContext<{ name: string }>>().toEqualTypeOf<
      ServerContext<{ name: string }>
    >();
  });

  it('produces compile error when passing non-function to $server()', () => {
    // **Validates: Requirements 10.6**
    // @ts-expect-error passing a string literal is not a valid function argument
    $server('not a function');

    // @ts-expect-error passing a number is not a valid function argument
    $server(42);

    // @ts-expect-error passing an object is not a valid function argument
    $server({ key: 'value' });
  });
});

describe('$get type inference', () => {
  it('infers return type', () => {
    const fn = $get(async (c) => ({ id: 1, name: 'test' }));
    expectTypeOf(fn).returns.toEqualTypeOf<Promise<{ id: number; name: string }>>();
  });

  it('accepts optional query and optional options when query is untyped', () => {
    const fn = $get(async (c) => 'ok');
    fn();
    fn({ page: '1' });
    fn(undefined, { headers: { Authorization: 'Bearer x' } });
    fn({ page: '1' }, { headers: { Authorization: 'Bearer x' } });
  });

  it('requires typed query as first arg', () => {
    const fn = $get(async (c: ServerContext<never, { id: string }>) => ({ id: c.req.query('id') }));
    fn({ id: '123' });
    fn({ id: '123' }, { headers: { 'X-Custom': 'val' } });
    // @ts-expect-error missing required query property
    fn({});
    // @ts-expect-error query is required when TQuery is typed
    fn();
  });

  it('accepts named query interfaces and preserves optional query fields', () => {
    interface SearchQuery {
      q: string;
      cursor?: string;
    }

    const fn = $get(async (c: ServerContext<never, SearchQuery>) => ({
      q: c.req.query('q'),
      cursor: c.req.query('cursor'),
    }));

    expectTypeOf(fn).parameters.toEqualTypeOf<[
      query: SearchQuery,
      options?: FetchOptions,
    ]>();
    expectTypeOf(fn).returns.toEqualTypeOf<
      Promise<{ q: string; cursor: string | undefined }>
    >();
    fn({ q: 'types' });
    fn({ q: 'types', cursor: 'next' });
    // @ts-expect-error required query field is missing
    fn({ cursor: 'next' });
  });

  it('rejects non-string query fields', () => {
    interface InvalidQuery {
      page: number;
    }

    // @ts-expect-error URL query values must be strings
    $get(async (c: ServerContext<never, InvalidQuery>) => c.req.query('page'));
  });

  it('infers FetchOptions shape correctly', () => {
    const fn = $get(async (c) => 'ok');
    // @ts-expect-error headers must be Record<string, string>
    fn(undefined, { headers: { key: 123 } });
  });
});

describe('$post type inference', () => {
  it('infers body type and return type', () => {
    const fn = $post(async (c: ServerContext<{ name: string }>) => {
      const body = await c.req.json();
      return { id: 1, name: body.name };
    });
    expectTypeOf(fn).returns.toEqualTypeOf<Promise<{ id: number; name: string }>>();
    fn({ name: 'test' });
    fn({ name: 'test' }, undefined, { headers: { Authorization: 'Bearer x' } });
    // @ts-expect-error wrong body type
    fn({ wrong: true });
  });

  it('accepts body + typed query + options', () => {
    const fn = $post(async (c: ServerContext<{ name: string }, { page: string }>) => 'ok');
    fn({ name: 'test' }, { page: '1' });
    fn({ name: 'test' }, { page: '1' }, { headers: { 'X-Custom': 'val' } });
    // @ts-expect-error missing required query property
    fn({ name: 'test' }, {});
  });

  it('accepts optional query when untyped', () => {
    const fn = $post(async (c: ServerContext<{ name: string }>) => 'ok');
    fn({ name: 'test' });
    fn({ name: 'test' }, { sort: 'asc' });
    fn({ name: 'test' }, undefined, { headers: { Authorization: 'Bearer x' } });
  });

  it('matches the exported body client utility type', () => {
    interface Body {
      name: string;
    }
    interface Query {
      dryRun?: string;
    }

    const fn = $post(async (c: ServerContext<Body, Query>) => {
      const body = await c.req.json();
      return { name: body.name, dryRun: c.req.query('dryRun') };
    });

    expectTypeOf(fn).toEqualTypeOf<
      BodyServerFunction<
        Body,
        Query,
        { name: string; dryRun: string | undefined }
      >
    >();
  });
});

describe('$put type inference', () => {
  it('mirrors $post behavior', () => {
    const fn = $put(async (c: ServerContext<{ value: number }>) => ({ updated: true }));
    fn({ value: 42 });
    fn({ value: 42 }, undefined, { headers: { Authorization: 'Bearer x' } });
    expectTypeOf(fn).returns.toEqualTypeOf<Promise<{ updated: boolean }>>();
    // @ts-expect-error wrong body type
    fn('bad');
  });
});

describe('$patch type inference', () => {
  it('mirrors $post behavior', () => {
    const fn = $patch(async (c: ServerContext<{ partial: boolean }>) => 'patched');
    fn({ partial: true });
    fn({ partial: true }, undefined, { headers: { Authorization: 'Bearer x' } });
    // @ts-expect-error wrong body type
    fn({});
  });
});

describe('$delete type inference', () => {
  it('mirrors $get behavior', () => {
    const fn = $delete(async (c: ServerContext<never, { id: string }>) => ({ deleted: true }));
    fn({ id: '123' });
    fn({ id: '123' }, { headers: { Authorization: 'Bearer x' } });
    expectTypeOf(fn).returns.toEqualTypeOf<Promise<{ deleted: boolean }>>();
    // @ts-expect-error missing required query
    fn();
  });

  it('accepts optional query when untyped', () => {
    const fn = $delete(async (c) => 'ok');
    fn();
    fn({ id: '123' });
    fn(undefined, { headers: { Authorization: 'Bearer x' } });
  });
});

describe('$head type inference', () => {
  it('mirrors $get behavior', () => {
    const fn = $head(async (c: ServerContext<never, { id: string }>) => ({ exists: true }));
    fn({ id: '123' });
    fn({ id: '123' }, { headers: { 'X-Custom': 'val' } });
    expectTypeOf(fn).returns.toEqualTypeOf<Promise<{ exists: boolean }>>();
    // @ts-expect-error missing required query
    fn();
  });

  it('accepts optional query when untyped', () => {
    const fn = $head(async (c) => 'ok');
    fn();
    fn({ id: '123' });
    fn(undefined, { headers: { Authorization: 'Bearer x' } });
  });
});
