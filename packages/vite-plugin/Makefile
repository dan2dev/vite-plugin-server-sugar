.PHONY: help version show-version bump-version ensure-clean typecheck test build pack-dry-run check publish publish-dry-run release-patch release-minor release-major

.DEFAULT_GOAL := help

# BUMP can be: patch | minor | major
BUMP ?= patch

PKG_FILE := package.json
PKG_NAME := $(shell node -p 'require("./$(PKG_FILE)").name')

version:
	@node -p 'require("./$(PKG_FILE)").version'

show-version: version

bump-version:
	@node -e 'const fs = require("node:fs"); const pkgPath = process.argv[1]; const bump = process.argv[2]; const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); const parts = pkg.version.split(".").map(Number); if (parts.length !== 3 || parts.some(Number.isNaN)) { console.error("Unsupported version format: " + pkg.version); process.exit(1); } if (bump === "patch") { parts[2] += 1; } else if (bump === "minor") { parts[1] += 1; parts[2] = 0; } else if (bump === "major") { parts[0] += 1; parts[1] = 0; parts[2] = 0; } else { console.error("Unsupported bump type: " + bump); process.exit(1); } pkg.version = parts.join("."); fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n"); console.log(pkg.version);' "$(PKG_FILE)" "$(BUMP)"

ensure-clean:
	@if ! git diff --quiet || ! git diff --cached --quiet; then \
		echo "Working tree not clean. Commit or stash changes before publishing."; \
		exit 1; \
	fi

typecheck:
	@bun run typecheck

test:
	@bun run test

build:
	@bun run build

pack-dry-run: build
	@npm pack --dry-run

check: typecheck test pack-dry-run

publish-dry-run: pack-dry-run
	@echo "Dry run complete for $(PKG_NAME)@$$(node -p 'require(\"./$(PKG_FILE)\").version')"

publish:
	@echo "==> Building $(PKG_NAME)"
	@bun run build
	@echo "==> Inspecting package contents"
	@npm pack --dry-run
	@echo "==> Logging in to npm registry"
	@if ! npm login; then \
		echo "ERROR: npm login failed. Cannot proceed with publish."; \
		exit 1; \
	fi
	@echo "==> Bumping $(BUMP) version"
	@new_version=$$($(MAKE) --no-print-directory bump-version BUMP=$(BUMP)); \
		echo "==> New version: $$new_version"; \
		echo "==> Staging version bump"; \
		git add $(PKG_FILE); \
		if git diff --cached --quiet; then \
			echo "==> No staged changes to commit"; \
		else \
			git commit -m "chore(vite-plugin): bump $(PKG_NAME) to $$new_version"; \
		fi; \
		echo "==> Publishing to npm"; \
		bun publish --no-git-checks && \
		echo "==> Creating tag if missing"; \
		if git rev-parse -q --verify "refs/tags/v$$new_version" >/dev/null; then \
			echo "Tag v$$new_version already exists - skipping"; \
		else \
			git tag -a "v$$new_version" -m "Release v$$new_version"; \
			echo "Created tag v$$new_version"; \
		fi; \
		echo "==> Pushing commit + tag"; \
		git push --follow-tags
	@echo "==> Done."

release-patch:
	@$(MAKE) publish BUMP=patch

release-minor:
	@$(MAKE) publish BUMP=minor

release-major:
	@$(MAKE) publish BUMP=major

help:
	@echo "$(PKG_NAME) release targets:"
	@echo "  make publish-dry-run       -> build and inspect npm package contents"
	@echo "  make publish               -> bump PATCH, publish, commit, tag, push"
	@echo "  make publish BUMP=minor    -> bump MINOR"
	@echo "  make publish BUMP=major    -> bump MAJOR"
	@echo "  make release-patch         -> publish BUMP=patch"
	@echo "  make release-minor         -> publish BUMP=minor"
	@echo "  make release-major         -> publish BUMP=major"
	@echo ""
	@echo "Checks:"
	@echo "  make typecheck             -> bun run typecheck"
	@echo "  make test                  -> bun run test"
	@echo "  make build                 -> bun run build"
	@echo "  make pack-dry-run          -> build and run npm pack --dry-run"
	@echo "  make check                 -> typecheck, test, build, pack dry-run"
	@echo ""
	@echo "Other:"
	@echo "  make version               -> show current package version"
	@echo "  make bump-version BUMP=... -> update package.json version only"
	@echo "  make ensure-clean          -> fail unless git tree is clean"
