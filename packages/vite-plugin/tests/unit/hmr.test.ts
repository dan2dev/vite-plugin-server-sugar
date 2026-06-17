import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ViteDevServer } from 'vite';
import type { InvalidationGraph } from '../../src/types';
import {
  invalidateActionModules,
  invalidateWsModules,
  invalidateActionFileModules,
} from '../../src/dev-server/hmr';
import {
  RESOLVED_PREFIX,
  RESOLVED_WS_PREFIX,
  RESOLVED_FILE_PREFIX,
} from '../../src/constants';

/**
 * Unit tests for HMR invalidation.
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5
 */

interface MockModule {
  id: string;
}

function createMockGraph(): InvalidationGraph<MockModule> & {
  getModuleById: ReturnType<typeof vi.fn>;
  invalidateModule: ReturnType<typeof vi.fn>;
  _modules: Map<string, MockModule>;
} {
  const modules = new Map<string, MockModule>();
  const graph = {
    _modules: modules,
    getModuleById: vi.fn((id: string) => modules.get(id)),
    invalidateModule: vi.fn(),
  };
  return graph;
}

function createMockServer(options?: {
  ssrGraph?: ReturnType<typeof createMockGraph> | null;
}): ViteDevServer & { moduleGraph: ReturnType<typeof createMockGraph> } {
  const mixedGraph = createMockGraph();

  const server = {
    moduleGraph: mixedGraph,
  } as unknown as ViteDevServer & { moduleGraph: ReturnType<typeof createMockGraph> };

  if (options?.ssrGraph !== undefined && options.ssrGraph !== null) {
    (server as unknown as Record<string, unknown>).environments = {
      ssr: { moduleGraph: options.ssrGraph },
    };
  }

  return server;
}

function addModuleToGraph(
  graph: ReturnType<typeof createMockGraph>,
  id: string,
): MockModule {
  const mod: MockModule = { id };
  graph._modules.set(id, mod);
  return mod;
}

describe('HMR Invalidation', () => {
  describe('empty invalidation list results in early return', () => {
    it('invalidateActionModules performs no graph operations for empty endpoints', () => {
      const server = createMockServer();
      addModuleToGraph(server.moduleGraph, RESOLVED_PREFIX + 'some-endpoint');

      invalidateActionModules(server, []);

      expect(server.moduleGraph.getModuleById).not.toHaveBeenCalled();
      expect(server.moduleGraph.invalidateModule).not.toHaveBeenCalled();
    });

    it('invalidateWsModules performs no graph operations for empty endpoints', () => {
      const server = createMockServer();
      addModuleToGraph(server.moduleGraph, RESOLVED_WS_PREFIX + 'ws-endpoint');

      invalidateWsModules(server, []);

      expect(server.moduleGraph.getModuleById).not.toHaveBeenCalled();
      expect(server.moduleGraph.invalidateModule).not.toHaveBeenCalled();
    });

    it('invalidateActionFileModules performs no graph operations for empty files', () => {
      const server = createMockServer();
      addModuleToGraph(
        server.moduleGraph,
        RESOLVED_FILE_PREFIX + encodeURIComponent('/src/test.ts'),
      );

      invalidateActionFileModules(server, []);

      expect(server.moduleGraph.getModuleById).not.toHaveBeenCalled();
      expect(server.moduleGraph.invalidateModule).not.toHaveBeenCalled();
    });

    it('deduplicates endpoints before checking — duplicate-only iterable still early returns if unique set is empty', () => {
      const server = createMockServer();

      // An empty Set passed as iterable
      invalidateActionModules(server, new Set<string>());

      expect(server.moduleGraph.getModuleById).not.toHaveBeenCalled();
      expect(server.moduleGraph.invalidateModule).not.toHaveBeenCalled();
    });
  });

  describe('file deletion invalidates all previously registered virtual modules', () => {
    it('invalidateActionModules invalidates all endpoint virtual modules for a file', () => {
      const server = createMockServer();
      const endpoints = ['endpoint-a', 'endpoint-b', 'endpoint-c'];

      // Add virtual modules for each endpoint
      const mods = endpoints.map((ep) =>
        addModuleToGraph(server.moduleGraph, RESOLVED_PREFIX + ep),
      );

      // Simulate file deletion: invalidate all endpoints that were registered for the file
      invalidateActionModules(server, endpoints);

      expect(server.moduleGraph.getModuleById).toHaveBeenCalledTimes(3);
      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledTimes(3);

      for (let i = 0; i < endpoints.length; i++) {
        expect(server.moduleGraph.getModuleById).toHaveBeenCalledWith(
          RESOLVED_PREFIX + endpoints[i],
        );
        expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(
          mods[i],
          expect.any(Set),
          expect.any(Number),
          true,
        );
      }
    });

    it('invalidateWsModules invalidates all ws virtual modules for a file', () => {
      const server = createMockServer();
      const endpoints = ['ws-chat', 'ws-notifications'];

      const mods = endpoints.map((ep) =>
        addModuleToGraph(server.moduleGraph, RESOLVED_WS_PREFIX + ep),
      );

      invalidateWsModules(server, endpoints);

      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledTimes(2);
      for (let i = 0; i < endpoints.length; i++) {
        expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(
          mods[i],
          expect.any(Set),
          expect.any(Number),
          true,
        );
      }
    });

    it('invalidateActionFileModules invalidates file-level virtual modules for deleted files', () => {
      const server = createMockServer();
      const files = ['/src/todos.ts', '/src/auth.ts'];

      const mods = files.map((file) =>
        addModuleToGraph(
          server.moduleGraph,
          RESOLVED_FILE_PREFIX + encodeURIComponent(file),
        ),
      );

      invalidateActionFileModules(server, files);

      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledTimes(2);
      for (let i = 0; i < files.length; i++) {
        expect(server.moduleGraph.getModuleById).toHaveBeenCalledWith(
          RESOLVED_FILE_PREFIX + encodeURIComponent(files[i]),
        );
        expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(
          mods[i],
          expect.any(Set),
          expect.any(Number),
          true,
        );
      }
    });

    it('skips modules not found in the graph without crashing', () => {
      const server = createMockServer();

      // These endpoints have no modules registered in the graph
      invalidateActionModules(server, ['nonexistent-a', 'nonexistent-b']);

      expect(server.moduleGraph.getModuleById).toHaveBeenCalledTimes(2);
      expect(server.moduleGraph.invalidateModule).not.toHaveBeenCalled();
    });
  });

  describe('both SSR and mixed module graphs are invalidated when both exist', () => {
    it('invalidateActionModules invalidates in both SSR and mixed graphs', () => {
      const ssrGraph = createMockGraph();
      const server = createMockServer({ ssrGraph });
      const endpoint = 'shared-endpoint';

      const mixedMod = addModuleToGraph(server.moduleGraph, RESOLVED_PREFIX + endpoint);
      const ssrMod = addModuleToGraph(ssrGraph, RESOLVED_PREFIX + endpoint);

      invalidateActionModules(server, [endpoint]);

      // Both graphs should have getModuleById called
      expect(server.moduleGraph.getModuleById).toHaveBeenCalledWith(
        RESOLVED_PREFIX + endpoint,
      );
      expect(ssrGraph.getModuleById).toHaveBeenCalledWith(
        RESOLVED_PREFIX + endpoint,
      );

      // Both graphs should have invalidateModule called
      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(
        mixedMod,
        expect.any(Set),
        expect.any(Number),
        true,
      );
      expect(ssrGraph.invalidateModule).toHaveBeenCalledWith(
        ssrMod,
        expect.any(Set),
        expect.any(Number),
        true,
      );
    });

    it('invalidateWsModules invalidates in both SSR and mixed graphs', () => {
      const ssrGraph = createMockGraph();
      const server = createMockServer({ ssrGraph });
      const endpoint = 'ws-shared';

      const mixedMod = addModuleToGraph(server.moduleGraph, RESOLVED_WS_PREFIX + endpoint);
      const ssrMod = addModuleToGraph(ssrGraph, RESOLVED_WS_PREFIX + endpoint);

      invalidateWsModules(server, [endpoint]);

      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(
        mixedMod,
        expect.any(Set),
        expect.any(Number),
        true,
      );
      expect(ssrGraph.invalidateModule).toHaveBeenCalledWith(
        ssrMod,
        expect.any(Set),
        expect.any(Number),
        true,
      );
    });

    it('invalidateActionFileModules invalidates in both SSR and mixed graphs', () => {
      const ssrGraph = createMockGraph();
      const server = createMockServer({ ssrGraph });
      const file = '/src/api.ts';
      const fileId = RESOLVED_FILE_PREFIX + encodeURIComponent(file);

      const mixedMod = addModuleToGraph(server.moduleGraph, fileId);
      const ssrMod = addModuleToGraph(ssrGraph, fileId);

      invalidateActionFileModules(server, [file]);

      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(
        mixedMod,
        expect.any(Set),
        expect.any(Number),
        true,
      );
      expect(ssrGraph.invalidateModule).toHaveBeenCalledWith(
        ssrMod,
        expect.any(Set),
        expect.any(Number),
        true,
      );
    });

    it('only uses mixed graph when SSR graph is the same instance', () => {
      // When ssrGraph === mixedGraph, only one graph should be used
      const server = createMockServer(); // No separate SSR graph
      const endpoint = 'solo-endpoint';

      addModuleToGraph(server.moduleGraph, RESOLVED_PREFIX + endpoint);

      invalidateActionModules(server, [endpoint]);

      // Should only be called once (one graph)
      expect(server.moduleGraph.getModuleById).toHaveBeenCalledTimes(1);
      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledTimes(1);
    });

    it('handles case where module exists in one graph but not the other', () => {
      const ssrGraph = createMockGraph();
      const server = createMockServer({ ssrGraph });
      const endpoint = 'partial-endpoint';

      // Only add to mixed graph, not SSR graph
      const mixedMod = addModuleToGraph(server.moduleGraph, RESOLVED_PREFIX + endpoint);

      invalidateActionModules(server, [endpoint]);

      // Mixed graph has the module - should invalidate
      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledWith(
        mixedMod,
        expect.any(Set),
        expect.any(Number),
        true,
      );
      // SSR graph doesn't have it - should not invalidate
      expect(ssrGraph.invalidateModule).not.toHaveBeenCalled();
    });

    it('invalidates multiple endpoints across both graphs', () => {
      const ssrGraph = createMockGraph();
      const server = createMockServer({ ssrGraph });
      const endpoints = ['ep-1', 'ep-2', 'ep-3'];

      const mixedMods = endpoints.map((ep) =>
        addModuleToGraph(server.moduleGraph, RESOLVED_PREFIX + ep),
      );
      const ssrMods = endpoints.map((ep) =>
        addModuleToGraph(ssrGraph, RESOLVED_PREFIX + ep),
      );

      invalidateActionModules(server, endpoints);

      // 3 endpoints × 2 graphs = 6 getModuleById calls total
      expect(server.moduleGraph.getModuleById).toHaveBeenCalledTimes(3);
      expect(ssrGraph.getModuleById).toHaveBeenCalledTimes(3);

      // Each module in each graph should be invalidated
      expect(server.moduleGraph.invalidateModule).toHaveBeenCalledTimes(3);
      expect(ssrGraph.invalidateModule).toHaveBeenCalledTimes(3);
    });
  });
});
