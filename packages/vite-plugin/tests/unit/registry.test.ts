import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/core/registry';

/**
 * Unit tests for the Registry class.
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

interface TestEntry {
  file: string;
  endpoint: string;
}

function makeEntry(file: string, endpoint: string): TestEntry {
  return { file, endpoint };
}

describe('Registry', () => {
  describe('set', () => {
    it('adds entry to the endpoint map', () => {
      const reg = new Registry<TestEntry>();
      const entry = makeEntry('/src/a.ts', '/api/foo');

      reg.set('/api/foo', entry);

      expect(reg.get('/api/foo')).toBe(entry);
      expect(reg.has('/api/foo')).toBe(true);
      expect(reg.size).toBe(1);
    });

    it('adds entry to the endpoint map but does not automatically update the file index', () => {
      const reg = new Registry<TestEntry>();
      const entry = makeEntry('/src/a.ts', '/api/foo');

      reg.set('/api/foo', entry);

      // set alone does not populate entriesByFile — that's registerFile's job
      const fileEndpoints = reg.getEndpointsForFile('/src/a.ts');
      expect(fileEndpoints.size).toBe(0);
    });

    it('overwrites existing entry for the same endpoint', () => {
      const reg = new Registry<TestEntry>();
      const entry1 = makeEntry('/src/a.ts', '/api/foo');
      const entry2 = makeEntry('/src/b.ts', '/api/foo');

      reg.set('/api/foo', entry1);
      reg.set('/api/foo', entry2);

      expect(reg.get('/api/foo')).toBe(entry2);
      expect(reg.size).toBe(1);
    });
  });

  describe('unregisterFile', () => {
    it('removes all endpoints for a file from the endpoint map', () => {
      const reg = new Registry<TestEntry>();
      const entry1 = makeEntry('/src/a.ts', '/api/foo');
      const entry2 = makeEntry('/src/a.ts', '/api/bar');

      reg.set('/api/foo', entry1);
      reg.set('/api/bar', entry2);
      reg.registerFile('/src/a.ts', ['/api/foo', '/api/bar']);

      reg.unregisterFile('/src/a.ts');

      expect(reg.has('/api/foo')).toBe(false);
      expect(reg.has('/api/bar')).toBe(false);
      expect(reg.size).toBe(0);
    });

    it('removes the file from the file index', () => {
      const reg = new Registry<TestEntry>();
      const entry = makeEntry('/src/a.ts', '/api/foo');

      reg.set('/api/foo', entry);
      reg.registerFile('/src/a.ts', ['/api/foo']);

      reg.unregisterFile('/src/a.ts');

      const fileEndpoints = reg.getEndpointsForFile('/src/a.ts');
      expect(fileEndpoints.size).toBe(0);
    });

    it('does not remove endpoints belonging to other files', () => {
      const reg = new Registry<TestEntry>();
      const entryA = makeEntry('/src/a.ts', '/api/foo');
      const entryB = makeEntry('/src/b.ts', '/api/bar');

      reg.set('/api/foo', entryA);
      reg.set('/api/bar', entryB);
      reg.registerFile('/src/a.ts', ['/api/foo']);
      reg.registerFile('/src/b.ts', ['/api/bar']);

      reg.unregisterFile('/src/a.ts');

      // File B's endpoint is untouched
      expect(reg.has('/api/bar')).toBe(true);
      expect(reg.get('/api/bar')).toBe(entryB);
      expect(reg.getEndpointsForFile('/src/b.ts').has('/api/bar')).toBe(true);
    });

    it('does not remove endpoint if it was re-registered by another file', () => {
      const reg = new Registry<TestEntry>();
      const entryA = makeEntry('/src/a.ts', '/api/foo');
      const entryB = makeEntry('/src/b.ts', '/api/foo');

      // File A originally registered /api/foo
      reg.set('/api/foo', entryA);
      reg.registerFile('/src/a.ts', ['/api/foo']);

      // File B takes over /api/foo
      reg.set('/api/foo', entryB);
      reg.registerFile('/src/b.ts', ['/api/foo']);

      // Unregistering file A should NOT remove /api/foo because it now belongs to file B
      reg.unregisterFile('/src/a.ts');

      expect(reg.has('/api/foo')).toBe(true);
      expect(reg.get('/api/foo')).toBe(entryB);
    });

    it('is a no-op for files not in the index', () => {
      const reg = new Registry<TestEntry>();
      const entry = makeEntry('/src/a.ts', '/api/foo');

      reg.set('/api/foo', entry);
      reg.registerFile('/src/a.ts', ['/api/foo']);

      // Unregistering a file that was never registered does nothing
      reg.unregisterFile('/src/nonexistent.ts');

      expect(reg.has('/api/foo')).toBe(true);
      expect(reg.size).toBe(1);
    });
  });

  describe('registerFile', () => {
    it('registers a file with its endpoints in the file index', () => {
      const reg = new Registry<TestEntry>();

      reg.registerFile('/src/a.ts', ['/api/foo', '/api/bar']);

      const fileEndpoints = reg.getEndpointsForFile('/src/a.ts');
      expect(fileEndpoints.has('/api/foo')).toBe(true);
      expect(fileEndpoints.has('/api/bar')).toBe(true);
      expect(fileEndpoints.size).toBe(2);
    });

    it('performs unregister-then-register atomically (replaces existing entries)', () => {
      const reg = new Registry<TestEntry>();
      const oldEntry = makeEntry('/src/a.ts', '/api/old');
      const newEntry = makeEntry('/src/a.ts', '/api/new');

      // Initial registration
      reg.set('/api/old', oldEntry);
      reg.registerFile('/src/a.ts', ['/api/old']);

      // Re-register with new endpoints
      reg.set('/api/new', newEntry);
      reg.registerFile('/src/a.ts', ['/api/new']);

      // Old endpoint should be removed from both maps
      expect(reg.has('/api/old')).toBe(false);
      // New endpoint should be present
      expect(reg.has('/api/new')).toBe(true);
      // File index should only contain new endpoints
      const fileEndpoints = reg.getEndpointsForFile('/src/a.ts');
      expect(fileEndpoints.has('/api/old')).toBe(false);
      expect(fileEndpoints.has('/api/new')).toBe(true);
      expect(fileEndpoints.size).toBe(1);
    });

    it('does not affect other files when re-registering', () => {
      const reg = new Registry<TestEntry>();
      const entryA = makeEntry('/src/a.ts', '/api/a');
      const entryB = makeEntry('/src/b.ts', '/api/b');
      const newEntryA = makeEntry('/src/a.ts', '/api/a2');

      reg.set('/api/a', entryA);
      reg.set('/api/b', entryB);
      reg.registerFile('/src/a.ts', ['/api/a']);
      reg.registerFile('/src/b.ts', ['/api/b']);

      // Re-register file A with different endpoints
      reg.set('/api/a2', newEntryA);
      reg.registerFile('/src/a.ts', ['/api/a2']);

      // File B should be untouched
      expect(reg.has('/api/b')).toBe(true);
      expect(reg.get('/api/b')).toBe(entryB);
      expect(reg.getEndpointsForFile('/src/b.ts').has('/api/b')).toBe(true);
    });
  });

  describe('clear', () => {
    it('empties the endpoint map', () => {
      const reg = new Registry<TestEntry>();
      reg.set('/api/foo', makeEntry('/src/a.ts', '/api/foo'));
      reg.set('/api/bar', makeEntry('/src/b.ts', '/api/bar'));
      reg.registerFile('/src/a.ts', ['/api/foo']);
      reg.registerFile('/src/b.ts', ['/api/bar']);

      reg.clear();

      expect(reg.size).toBe(0);
      expect(reg.has('/api/foo')).toBe(false);
      expect(reg.has('/api/bar')).toBe(false);
    });

    it('empties the file index', () => {
      const reg = new Registry<TestEntry>();
      reg.set('/api/foo', makeEntry('/src/a.ts', '/api/foo'));
      reg.set('/api/bar', makeEntry('/src/b.ts', '/api/bar'));
      reg.registerFile('/src/a.ts', ['/api/foo']);
      reg.registerFile('/src/b.ts', ['/api/bar']);

      reg.clear();

      expect(reg.getEndpointsForFile('/src/a.ts').size).toBe(0);
      expect(reg.getEndpointsForFile('/src/b.ts').size).toBe(0);
    });

    it('allows fresh registrations after clearing', () => {
      const reg = new Registry<TestEntry>();
      reg.set('/api/foo', makeEntry('/src/a.ts', '/api/foo'));
      reg.registerFile('/src/a.ts', ['/api/foo']);

      reg.clear();

      // Register fresh entries
      const newEntry = makeEntry('/src/c.ts', '/api/new');
      reg.set('/api/new', newEntry);
      reg.registerFile('/src/c.ts', ['/api/new']);

      expect(reg.has('/api/new')).toBe(true);
      expect(reg.get('/api/new')).toBe(newEntry);
      expect(reg.getEndpointsForFile('/src/c.ts').has('/api/new')).toBe(true);
    });
  });
});
