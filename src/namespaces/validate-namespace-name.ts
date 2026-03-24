const VALID_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const RESERVED_NAMES = ['root', 'system', 'admin', 'registry'];

export function validateNamespaceName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Namespace name must be a non-empty string');
  }

  if (!VALID_NAME_PATTERN.test(name)) {
    throw new Error(
      'Namespace name must contain only alphanumeric characters, dashes, and underscores',
    );
  }

  if (RESERVED_NAMES.includes(name.toLowerCase())) {
    throw new Error(`Namespace name '${name}' is reserved`);
  }

  if (name.includes('-ns-')) {
    throw new Error(
      "Namespace name must not contain '-ns-' (reserved as internal separator)",
    );
  }

  if (name.length < 3 || name.length > 64) {
    throw new Error('Namespace name must be between 3 and 64 characters');
  }
}
