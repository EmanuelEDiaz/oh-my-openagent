import { describe, expect, test } from "bun:test"

import { AUTO_INSTALLABLE_SERVERS, LSP_INSTALL_HINTS, LSP_LOCAL_INSTALL_HINTS } from "./server-definitions.js"

// Fork 0.25 (21-10-2026): `typescript` with no version installs TypeScript 7, which has no tsserver.js, so
// typescript-language-server cannot start. Every way the plugin tells someone to install it pins version 6.
describe("TypeScript install commands", () => {
	test("#given the global and local hints and the auto-install command #then each pins typescript to version 6", () => {
		const commands = [LSP_INSTALL_HINTS["typescript"], LSP_LOCAL_INSTALL_HINTS["typescript"], AUTO_INSTALLABLE_SERVERS["typescript"]?.join(" ")]
		for (const command of commands) {
			expect(command).toMatch(/(^|\s)typescript@6(\s|$)/)
			expect(command).toMatch(/typescript-language-server@6/)
		}
	})
})
