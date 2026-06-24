/**
 * Package version — single source of truth derived from package.json.
 *
 * Import this module when you need the version string in source code
 * rather than duplicating the literal in multiple places.
 */
import packageJson from '../package.json';

export const VERSION: string = packageJson.version;
